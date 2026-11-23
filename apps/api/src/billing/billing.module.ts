import { Module } from "@nestjs/common";
import { InvoicesController, PublicInvoicesController, QuotesController } from "./billing.controller";
import { InvoicesService } from "./invoices.service";
import { PaymentLedger } from "./payment-ledger.service";
import { QuotesService } from "./quotes.service";
import { RemindersService } from "./reminders.service";

/** Core billing: quotes, invoices, manual payments, PDFs, reminders, public invoice view. */
@Module({
  controllers: [InvoicesController, QuotesController, PublicInvoicesController],
  providers: [InvoicesService, QuotesService, PaymentLedger, RemindersService],
  exports: [InvoicesService, PaymentLedger, RemindersService],
})
export class BillingModule {}
