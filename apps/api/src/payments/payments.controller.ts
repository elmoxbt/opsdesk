import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { tenantContext } from "@opsdesk/db";
import { type CheckoutDto, startCheckoutSchema, type StartCheckoutInput } from "@opsdesk/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { AppException } from "../common/app-exception";
import { ApiZodBody, Public } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ENV, type Env } from "../config/env";
import { RequireFeature } from "../features/require-feature";
import { SystemLookupService } from "../system/system-lookup.service";
import { FakeGateway } from "./fake.gateway";
import { InvalidSignatureError, PAYMENT_GATEWAY, type PaymentGateway } from "./payment-provider";
import { PaymentsService } from "./payments.service";
import { RateLimit } from "../common/rate-limit";

const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const verifySchema = z.object({ reference: z.string().regex(/^ops_[a-f0-9]{32}$/) });

/** Online payment from the public invoice page. Part of the `payments` feature. */
@ApiTags("public")
@Public()
@RequireFeature("payments")
@Controller("public/invoices/:token")
export class PublicPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly lookup: SystemLookupService,
  ) {}

  @Post("checkout")
  @RateLimit({ limit: 10, windowSec: 600, by: "ip" })
  @HttpCode(200)
  @ApiZodBody(startCheckoutSchema)
  async checkout(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(startCheckoutSchema)) body: StartCheckoutInput,
  ): Promise<CheckoutDto> {
    await this.enterTenant(token);
    return this.payments.startCheckout(token, body.email);
  }

  /** Called by the page when the payer comes back with ?reference=… */
  @Post("verify")
  @HttpCode(204)
  async verify(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>,
  ): Promise<void> {
    await this.enterTenant(token);
    await this.payments.verifyReturn(token, body.reference);
  }

  private async enterTenant(token: string): Promise<void> {
    const organizationId = TOKEN.test(token) ? await this.lookup.organizationForInvoiceToken(token) : null;
    if (!organizationId) throw new AppException("NOT_FOUND", "Invoice not found");
    tenantContext.set({ organizationId });
  }
}

@ApiTags("webhooks")
@Public()
@RequireFeature("payments")
@Controller()
export class PaymentWebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Point the Paystack dashboard's webhook URL here. 200 = handled (including
   * duplicates and events we don't care about); 401 = bad signature; 5xx =
   * temporary failure, so Paystack retries.
   */
  @Post("webhooks/payments")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>): Promise<{ received: true; result: string }> {
    if (!req.rawBody) throw new AppException("BAD_REQUEST", "Expected a JSON body");
    try {
      const result = await this.payments.handleWebhook(req.rawBody, req.headers);
      return { received: true, result };
    } catch (e) {
      if (e instanceof InvalidSignatureError) throw new AppException("UNAUTHENTICATED", "Invalid signature");
      if (e instanceof SyntaxError || e instanceof z.ZodError)
        throw new AppException("BAD_REQUEST", "Malformed event");
      throw e;
    }
  }

  // --- Fake gateway's hosted checkout page (dev/test only) ---------------------

  @Get("payments/fake/:reference")
  @ApiExcludeEndpoint()
  fakeCheckout(@Param("reference") reference: string, @Res() res: Response): void {
    const s = this.fake().session(reference);
    if (!s) throw new AppException("NOT_FOUND", "Unknown checkout");
    const amount = new Intl.NumberFormat("en", { style: "currency", currency: s.currency }).format(
      s.amountMinor / 100,
    );
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    res.type("html")
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;padding:32px;border-radius:16px;box-shadow:0 10px 30px #0001;max-width:360px;width:calc(100% - 32px)}p{color:#52525b}button{width:100%;padding:12px;border-radius:10px;border:0;font-size:15px;font-weight:600;margin-top:8px;cursor:pointer}.pay{background:#16a34a;color:#fff}.fail{background:#e4e4e7}</style></head>
<body><main><strong>TEST MODE</strong><h1 style="margin:8px 0">${esc(amount)}</h1><p>${esc(s.metadata.invoice ?? "")} &middot; ${esc(s.email)}</p>
<p>This stand-in for Paystack only exists in development. No money moves.</p>
<form method="post"><button class="pay" name="outcome" value="success">Pay ${esc(amount)}</button><button class="fail" name="outcome" value="failed">Simulate a declined card</button></form></main></body></html>`);
  }

  /** Simulates Paystack: sends the signed webhook through the real pipeline, then redirects back. */
  @Post("payments/fake/:reference")
  @ApiExcludeEndpoint()
  async fakeComplete(
    @Param("reference") reference: string,
    @Body() body: { outcome?: string },
    @Headers("accept") _accept: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const fake = this.fake();
    const session = fake.session(reference);
    const signed = fake.complete(reference, body.outcome === "failed" ? "failed" : "success");
    if (!session || !signed) throw new AppException("NOT_FOUND", "Unknown checkout");
    await this.payments.handleWebhook(signed.body, { "x-paystack-signature": signed.signature });
    const back = new URL(session.callbackUrl);
    back.searchParams.set("reference", reference);
    res.redirect(303, back.toString());
  }

  private fake(): FakeGateway {
    if (!(this.gateway instanceof FakeGateway) || this.env.NODE_ENV === "production")
      throw new AppException("NOT_FOUND", "Not found");
    return this.gateway;
  }
}
