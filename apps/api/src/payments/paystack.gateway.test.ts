import { describe, expect, it, vi } from "vitest";
import { InvalidSignatureError } from "./payment-provider";
import { PaystackGateway, paystackSignature, verifySignature } from "./paystack.gateway";

const SECRET = "sk_test_abc";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("Paystack signatures", () => {
  it("accepts the HMAC-SHA512 of the exact raw body and nothing else", () => {
    const raw = Buffer.from('{"event":"charge.success"}');
    const sig = paystackSignature(raw, SECRET);
    expect(verifySignature(raw, sig, SECRET)).toBe(true);
    expect(verifySignature(Buffer.from('{"event": "charge.success"}'), sig, SECRET)).toBe(false); // re-serialised
    expect(verifySignature(raw, sig, "sk_test_other")).toBe(false);
    expect(verifySignature(raw, undefined, SECRET)).toBe(false);
    expect(verifySignature(raw, "abc", SECRET)).toBe(false); // wrong length doesn't throw
  });
});

describe("PaystackGateway", () => {
  it("initializes a transaction in kobo with our reference and callback", async () => {
    const f = fakeFetch(200, {
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/x" },
    });
    const gw = new PaystackGateway(SECRET, "https://api.paystack.co", f);
    const res = await gw.initialize({
      reference: "ops_1",
      amountMinor: 3_500_000,
      currency: "NGN",
      email: "a@b.co",
      callbackUrl: "https://app/i/t",
      metadata: { invoice: "INV-0001" },
    });
    expect(res.authorizationUrl).toBe("https://checkout.paystack.com/x");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 3_500_000,
      reference: "ops_1",
      callback_url: "https://app/i/t",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("maps verify results and surfaces API errors", async () => {
    const ok = new PaystackGateway(
      SECRET,
      "https://api",
      fakeFetch(200, {
        status: true,
        data: {
          id: 1,
          reference: "ops_1",
          status: "success",
          amount: 100,
          currency: "ngn",
          paid_at: "2026-11-18T10:00:00Z",
        },
      }),
    );
    expect(await ok.verify("ops_1")).toMatchObject({ status: "success", amountMinor: 100, currency: "NGN" });
    expect(
      await new PaystackGateway(SECRET, "https://api", fakeFetch(404, { status: false })).verify("x"),
    ).toBeNull();
    await expect(
      new PaystackGateway(
        SECRET,
        "https://api",
        fakeFetch(401, { status: false, message: "Invalid key" }),
      ).verify("x"),
    ).rejects.toThrow(/Invalid key/);
  });

  it("parses signed webhooks and rejects unsigned ones", () => {
    const gw = new PaystackGateway(SECRET, "https://api");
    const raw = Buffer.from(
      JSON.stringify({
        event: "charge.success",
        data: { id: 42, reference: "ops_1", status: "success", amount: 500, currency: "NGN", paid_at: null },
      }),
    );
    const ev = gw.parseWebhook(raw, { "x-paystack-signature": paystackSignature(raw, SECRET) });
    expect(ev).toMatchObject({
      externalId: "charge.success:42",
      charge: { reference: "ops_1", amountMinor: 500 },
    });
    expect(() => gw.parseWebhook(raw, {})).toThrow(InvalidSignatureError);

    const transfer = Buffer.from(JSON.stringify({ event: "transfer.success", data: { id: 7 } }));
    expect(
      gw.parseWebhook(transfer, { "x-paystack-signature": paystackSignature(transfer, SECRET) }).charge,
    ).toBeNull();
  });
});
