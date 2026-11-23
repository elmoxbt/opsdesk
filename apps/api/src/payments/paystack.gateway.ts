import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  type ChargeResult,
  type CheckoutRequest,
  InvalidSignatureError,
  type PaymentGateway,
  type ProviderWebhookEvent,
} from "./payment-provider";

const transaction = z.object({
  id: z.union([z.number(), z.string()]),
  reference: z.string(),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  paid_at: z.string().nullish(),
});

const webhookBody = z.object({ event: z.string(), data: z.looseObject({}) });

const toCharge = (t: z.infer<typeof transaction>, raw: unknown): ChargeResult => ({
  reference: t.reference,
  status:
    t.status === "success"
      ? "success"
      : t.status === "failed" || t.status === "abandoned"
        ? "failed"
        : "pending",
  amountMinor: t.amount,
  currency: t.currency.toUpperCase(),
  paidAt: t.paid_at ? new Date(t.paid_at) : null,
  raw,
});

/** HMAC-SHA512 of the raw body with the secret key, compared in constant time. */
export function paystackSignature(rawBody: Buffer, secret: string): string {
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(paystackSignature(rawBody, secret), "hex");
  const given = Buffer.from(header, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Paystack (https://paystack.com/docs/api). Amounts are already in the lowest
 * unit (kobo), like ours. Plain fetch: three endpoints don't justify an SDK.
 */
export class PaystackGateway implements PaymentGateway {
  readonly provider = "PAYSTACK" as const;

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: unknown;
    } | null;
    if (res.status === 404) return null;
    if (!res.ok || !body?.status)
      throw new Error(`Paystack ${path}: ${res.status} ${body?.message ?? ""}`.trim());
    return body.data;
  }

  async initialize(req: CheckoutRequest): Promise<{ authorizationUrl: string }> {
    const data = z.object({ authorization_url: z.url() }).parse(
      await this.call("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: req.email,
          amount: req.amountMinor,
          currency: req.currency,
          reference: req.reference,
          callback_url: req.callbackUrl,
          metadata: req.metadata,
        }),
      }),
    );
    return { authorizationUrl: data.authorization_url };
  }

  async verify(reference: string): Promise<ChargeResult | null> {
    const data = await this.call(`/transaction/verify/${encodeURIComponent(reference)}`);
    return data ? toCharge(transaction.parse(data), data) : null;
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderWebhookEvent {
    const sig = headers["x-paystack-signature"];
    if (!verifySignature(rawBody, typeof sig === "string" ? sig : undefined, this.secretKey))
      throw new InvalidSignatureError();
    const raw: unknown = JSON.parse(rawBody.toString("utf8"));
    const body = webhookBody.parse(raw);
    const tx = body.event.startsWith("charge.") ? transaction.safeParse(body.data) : null;
    return {
      // Paystack has no event id; event type + transaction id is unique per state change.
      externalId: `${body.event}:${String(body.data.id ?? body.data.reference ?? "")}`,
      type: body.event,
      charge: tx?.success ? toCharge(tx.data, body.data) : null,
      raw,
    };
  }
}
