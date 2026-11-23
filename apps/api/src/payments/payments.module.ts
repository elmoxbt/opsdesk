import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { ENV, type Env } from "../config/env";
import { FakeGateway } from "./fake.gateway";
import { PAYMENT_GATEWAY, type PaymentGateway } from "./payment-provider";
import { PaymentWebhooksController, PublicPaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PaystackGateway } from "./paystack.gateway";

/**
 * `payments` feature: online "Pay now" + gateway webhooks. Without it,
 * invoices still work (manual payments, PDF, public view); the public page
 * shows bank-transfer instructions instead of a Pay button.
 */
@Module({
  imports: [BillingModule],
  controllers: [PublicPaymentsController, PaymentWebhooksController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ENV],
      // Checked here, not in env validation: a deployment with payments switched off needs no key.
      useFactory: (env: Env): PaymentGateway => {
        if (env.PAYMENTS_MODE === "fake") return new FakeGateway(env.APP_URL);
        if (!env.PAYSTACK_SECRET_KEY)
          throw new Error(
            "features.payments is on: set PAYSTACK_SECRET_KEY (or turn the feature off with FEATURE_PAYMENTS=false)",
          );
        return new PaystackGateway(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_BASE_URL);
      },
    },
  ],
})
export class PaymentsModule {}
