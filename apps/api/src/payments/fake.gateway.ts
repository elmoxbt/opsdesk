import { randomUUID } from "node:crypto";
import {
  type ChargeResult,
  type CheckoutRequest,
  InvalidSignatureError,
  type PaymentGateway,
  type ProviderWebhookEvent,
} from "./payment-provider";
import { paystackSignature, verifySignature } from "./paystack.gateway";

/** Not a secret: the fake gateway only exists outside production (enforced in env validation). */
export const FAKE_WEBHOOK_SECRET = "fake-gateway-secret";

interface FakeSession extends CheckoutRequest {
  outcome?: "success" | "failed";
  paidAt?: Date;
}

/**
 * Stand-in gateway for local dev, demos and tests. It mimics Paystack's shape
 * (hosted checkout page, signed webhook, verify endpoint) so the real pipeline
 * runs end to end with no account and no network.
 */
export class FakeGateway implements PaymentGateway {
  readonly provider = "FAKE" as const;
  private readonly sessions = new Map<string, FakeSession>();

  constructor(private readonly appUrl: string) {}

  async initialize(req: CheckoutRequest): Promise<{ authorizationUrl: string }> {
    this.sessions.set(req.reference, { ...req });
    return { authorizationUrl: `${this.appUrl.replace(/\/$/, "")}/api/payments/fake/${req.reference}` };
  }

  session(reference: string): FakeSession | undefined {
    return this.sessions.get(reference);
  }

  /** What the "Pay" button does: record the outcome and produce the webhook Paystack would send. */
  complete(reference: string, outcome: "success" | "failed"): { body: Buffer; signature: string } | null {
    const s = this.sessions.get(reference);
    if (!s) return null;
    s.outcome = outcome;
    s.paidAt = outcome === "success" ? new Date() : undefined;
    const body = Buffer.from(
      JSON.stringify({
        event: outcome === "success" ? "charge.success" : "charge.failed",
        data: {
          id: randomUUID(),
          reference,
          status: outcome,
          amount: s.amountMinor,
          currency: s.currency,
          paid_at: s.paidAt?.toISOString() ?? null,
        },
      }),
    );
    return { body, signature: paystackSignature(body, FAKE_WEBHOOK_SECRET) };
  }

  async verify(reference: string): Promise<ChargeResult | null> {
    const s = this.sessions.get(reference);
    if (!s) return null;
    return {
      reference,
      status: s.outcome ?? "pending",
      amountMinor: s.amountMinor,
      currency: s.currency,
      paidAt: s.paidAt ?? null,
      raw: { fake: true },
    };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderWebhookEvent {
    const sig = headers["x-paystack-signature"];
    if (!verifySignature(rawBody, typeof sig === "string" ? sig : undefined, FAKE_WEBHOOK_SECRET))
      throw new InvalidSignatureError();
    const raw = JSON.parse(rawBody.toString("utf8")) as {
      event: string;
      data: {
        id: string;
        reference: string;
        status: string;
        amount: number;
        currency: string;
        paid_at: string | null;
      };
    };
    return {
      externalId: `${raw.event}:${raw.data.id}`,
      type: raw.event,
      charge: {
        reference: raw.data.reference,
        status: raw.data.status === "success" ? "success" : "failed",
        amountMinor: raw.data.amount,
        currency: raw.data.currency,
        paidAt: raw.data.paid_at ? new Date(raw.data.paid_at) : null,
        raw: raw.data,
      },
      raw,
    };
  }
}
