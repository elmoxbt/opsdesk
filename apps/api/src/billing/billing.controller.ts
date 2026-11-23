import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { ApiKeyScope } from "../common/api-key-scope";
import { tenantContext } from "@opsdesk/db";
import {
  invoiceFromJobSchema,
  invoiceInputSchema,
  invoiceListQuerySchema,
  manualPaymentSchema,
  quoteInputSchema,
  quoteListQuerySchema,
  quoteStatusSchema,
  voidInvoiceSchema,
  type InvoiceDto,
  type InvoiceSummaryDto,
  type Paginated,
  type PublicInvoiceDto,
  type QuoteDto,
} from "@opsdesk/shared";
import type { z } from "zod";
import { AppException } from "../common/app-exception";
import { ApiZodBody, ApiZodQuery, Public, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SystemLookupService } from "../system/system-lookup.service";
import { InvoicesService } from "./invoices.service";
import { QuotesService } from "./quotes.service";

type Out<S extends z.ZodType> = z.output<S>;

/** Billing is office work: owners and dispatchers. Technicians never see prices owed. */
@ApiTags("invoices")
@ApiCookieAuth()
@Roles("OWNER", "DISPATCHER")
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiKeyScope("invoices:read")
  @ApiZodQuery(invoiceListQuerySchema)
  list(
    @Query(new ZodValidationPipe(invoiceListQuerySchema)) q: Out<typeof invoiceListQuerySchema>,
  ): Promise<Paginated<InvoiceDto>> {
    return this.invoices.list(q);
  }

  @Get("summary")
  summary(): Promise<InvoiceSummaryDto> {
    return this.invoices.summary();
  }

  @Get(":id")
  @ApiKeyScope("invoices:read")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<InvoiceDto> {
    return this.invoices.get(id);
  }

  @Post()
  @ApiZodBody(invoiceInputSchema)
  create(
    @Body(new ZodValidationPipe(invoiceInputSchema)) body: Out<typeof invoiceInputSchema>,
  ): Promise<InvoiceDto> {
    return this.invoices.create(body);
  }

  /** Draft from a completed job: its service + parts used. */
  @Post("from-job")
  @ApiZodBody(invoiceFromJobSchema)
  fromJob(
    @Body(new ZodValidationPipe(invoiceFromJobSchema)) body: Out<typeof invoiceFromJobSchema>,
  ): Promise<InvoiceDto> {
    return this.invoices.fromJob(body.jobId);
  }

  @Put(":id")
  @ApiZodBody(invoiceInputSchema)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(invoiceInputSchema)) body: Out<typeof invoiceInputSchema>,
  ): Promise<InvoiceDto> {
    return this.invoices.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.invoices.deleteDraft(id);
  }

  @Post(":id/issue")
  @HttpCode(200)
  issue(@Param("id", ParseUUIDPipe) id: string): Promise<InvoiceDto> {
    return this.invoices.issue(id);
  }

  @Post(":id/send")
  @HttpCode(200)
  send(@Param("id", ParseUUIDPipe) id: string): Promise<InvoiceDto> {
    return this.invoices.resend(id);
  }

  @Post(":id/void")
  @HttpCode(200)
  @Roles("OWNER")
  @ApiZodBody(voidInvoiceSchema)
  void(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(voidInvoiceSchema)) body: Out<typeof voidInvoiceSchema>,
  ): Promise<InvoiceDto> {
    return this.invoices.void(id, body.reason);
  }

  /** Cash/transfer/POS. Send an Idempotency-Key: a double-click must not record the money twice. */
  @Post(":id/payments")
  @ApiZodBody(manualPaymentSchema)
  recordPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(manualPaymentSchema)) body: Out<typeof manualPaymentSchema>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<InvoiceDto> {
    return this.invoices.recordManualPayment(id, body, idempotencyKey);
  }

  /** Short-lived signed URL to the current PDF (409 while it's still rendering). */
  @Get(":id/pdf")
  pdf(@Param("id", ParseUUIDPipe) id: string): Promise<{ url: string }> {
    return this.invoices.pdfUrl(id);
  }
}

@ApiTags("quotes")
@ApiCookieAuth()
@Roles("OWNER", "DISPATCHER")
@Controller("quotes")
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ApiZodQuery(quoteListQuerySchema)
  list(
    @Query(new ZodValidationPipe(quoteListQuerySchema)) q: Out<typeof quoteListQuerySchema>,
  ): Promise<Paginated<QuoteDto>> {
    return this.quotes.list(q);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<QuoteDto> {
    return this.quotes.get(id);
  }

  @Post()
  @ApiZodBody(quoteInputSchema)
  create(
    @Body(new ZodValidationPipe(quoteInputSchema)) body: Out<typeof quoteInputSchema>,
  ): Promise<QuoteDto> {
    return this.quotes.create(body);
  }

  @Put(":id")
  @ApiZodBody(quoteInputSchema)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(quoteInputSchema)) body: Out<typeof quoteInputSchema>,
  ): Promise<QuoteDto> {
    return this.quotes.update(id, body);
  }

  @Post(":id/status")
  @HttpCode(200)
  @ApiZodBody(quoteStatusSchema)
  setStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(quoteStatusSchema)) body: Out<typeof quoteStatusSchema>,
  ): Promise<QuoteDto> {
    return this.quotes.setStatus(id, body.status);
  }

  @Post(":id/convert")
  @HttpCode(200)
  convert(@Param("id", ParseUUIDPipe) id: string): Promise<InvoiceDto> {
    return this.quotes.convert(id);
  }
}

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/**
 * The customer's "view & pay" page. No login: the unguessable token IS the
 * credential (192 bits), like a Stripe hosted invoice link. Malformed and
 * unknown tokens get the same 404.
 */
@ApiTags("public")
@Public()
@Controller("public/invoices")
export class PublicInvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly lookup: SystemLookupService,
  ) {}

  @Get(":token")
  async get(@Param("token") token: string): Promise<PublicInvoiceDto> {
    return this.inTenant(token, async () => this.invoices.toPublic(await this.invoices.findByToken(token)));
  }

  @Get(":token/pdf")
  pdf(@Param("token") token: string): Promise<{ url: string }> {
    return this.inTenant(token, () => this.invoices.publicPdfUrl(token));
  }

  private async inTenant<T>(token: string, fn: () => Promise<T>): Promise<T> {
    const organizationId = TOKEN.test(token) ? await this.lookup.organizationForInvoiceToken(token) : null;
    if (!organizationId) throw new AppException("NOT_FOUND", "Invoice not found");
    tenantContext.set({ organizationId });
    return fn();
  }
}
