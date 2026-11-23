/**
 * What the rest of the app knows about a payment gateway. Paystack today;
 * Stripe (or Flutterwave) is another implementation of this interface, with no
 * change to invoices, the ledger or the webhook pipeline.
 */
export interface CheckoutRequest {
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  /** Where the gateway sends the payer afterwards (our public invoice page). */
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface ChargeResult {
  reference: string;
  status: "success" | "failed" | "pending";
  amountMinor: number;
  currency: string;
  paidAt: Date | null;
  raw: unknown;
}

export interface ProviderWebhookEvent {
  /** Provider's unique id for this delivery's event: the dedupe key. */
  externalId: string;
  type: string;
  /** Present for charge events; other event types are acknowledged and ignored. */
  charge: ChargeResult | null;
  raw: unknown;
}

export class InvalidSignatureError extends Error {
  constructor() {
    super("Invalid webhook signature");
    this.name = "InvalidSignatureError";
  }
}

export interface PaymentGateway {
  readonly provider: "PAYSTACK" | "FAKE";
  initialize(req: CheckoutRequest): Promise<{ authorizationUrl: string }>;
  /** Server-to-server lookup: the source of truth when the payer returns before the webhook arrives. */
  verify(reference: string): Promise<ChargeResult | null>;
  /** Verifies the signature over the RAW body, then parses. Throws InvalidSignatureError. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderWebhookEvent;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
