import type { JobStatus, Role } from "./constants";
import type { ChecklistItem } from "./schemas/jobs";

/**
 * API response contracts (what goes over the wire: dates are ISO strings).
 * The API maps Prisma rows to these; the web app consumes them. One definition,
 * so a backend change that breaks the frontend fails typecheck.
 */
export type ISODate = string;

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  jobCount?: number;
}

export interface ServiceTypeDto {
  id: string;
  name: string;
  description: string | null;
  defaultDurationMinutes: number;
  defaultPriceMinor: number;
  isActive: boolean;
  createdAt: ISODate;
}

export interface UserSummaryDto {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface UserDto extends UserSummaryDto {
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: ISODate | null;
  createdAt: ISODate;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: ISODate;
  createdAt: ISODate;
}

export interface JobDto {
  id: string;
  number: number;
  status: JobStatus;
  customer: Pick<CustomerDto, "id" | "name" | "phone" | "address">;
  serviceType: Pick<ServiceTypeDto, "id" | "name" | "defaultDurationMinutes">;
  technician: UserSummaryDto | null;
  scheduledStart: ISODate | null;
  scheduledEnd: ISODate | null;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  cancelledAt: ISODate | null;
  cancellationReason: string | null;
  checklist: ChecklistItem[];
  notes: string | null;
  priceMinor: number | null;
  version: number;
  /** "BOOKING" = came in through the public booking page. */
  source: "DASHBOARD" | "BOOKING" | "API";
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface JobStatsDto {
  byStatus: Record<JobStatus, number>;
  scheduledToday: number;
  unassigned: number;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: UserSummaryDto | null;
  actorType: "USER" | "SYSTEM" | "API_KEY" | "PUBLIC";
  before: unknown;
  after: unknown;
  createdAt: ISODate;
}

export const formatJobNumber = (n: number): string => `JOB-${String(n).padStart(4, "0")}`;

export interface DispatchBoardDto {
  technicians: UserSummaryDto[];
  /** Assigned, non-cancelled jobs overlapping the requested range. */
  jobs: JobDto[];
  /** REQUESTED jobs still missing a technician or a time (the "to schedule" tray). */
  unscheduled: JobDto[];
}

/** One clashing job, returned with a 409 so the UI can say what's in the way. */
export interface ScheduleConflictDto {
  id: string;
  number: number;
  customerName: string;
  scheduledStart: ISODate;
  scheduledEnd: ISODate;
}

/** "media"/"parts" don't alter the JobDto; they tell clients to refetch those lists. */
export type JobChangeKind = "created" | "updated" | "status_changed" | "rescheduled" | "media" | "parts";

/** Realtime event: sent to managers and to the affected technician(s) only. */
export interface JobChangedEvent {
  kind: JobChangeKind;
  job: JobDto;
  actor: { id: string; name: string } | null;
}

export const REALTIME_EVENTS = { jobChanged: "job.changed", invoicePaid: "invoice.paid" } as const;

export interface UploadTicketDto {
  /** Presigned PUT URL: valid for a few minutes, for exactly this key and content type. */
  uploadUrl: string;
  key: string;
  headers: Record<string, string>;
  expiresAt: ISODate;
}

export interface JobPhotoDto {
  id: string;
  kind: "BEFORE" | "AFTER";
  /** Presigned GET URL (short-lived): the bucket itself is private. */
  url: string;
  contentType: string;
  uploadedBy: UserSummaryDto | null;
  createdAt: ISODate;
}

export interface SignatureDto {
  url: string;
  signedByName: string;
  signedAt: ISODate;
}

export interface JobMediaDto {
  photos: JobPhotoDto[];
  signature: SignatureDto | null;
}

export interface InventoryItemDto {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  reorderThreshold: number;
  unitCostMinor: number;
  lowStock: boolean;
  createdAt: ISODate;
}

export interface JobPartDto {
  id: string;
  item: Pick<InventoryItemDto, "id" | "name" | "sku">;
  quantity: number;
  unitCostMinor: number;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface LineItemDto {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface QuoteDto {
  id: string;
  number: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "CONVERTED";
  customer: Pick<CustomerDto, "id" | "name" | "email" | "phone">;
  jobId: string | null;
  invoiceId: string | null;
  currency: string;
  taxRateBps: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  validUntil: ISODate | null;
  notes: string | null;
  lineItems: LineItemDto[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type PaymentStatusDto = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

export interface PaymentDto {
  id: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL" | "FAKE";
  reference: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatusDto;
  method: string | null;
  note: string | null;
  paidAt: ISODate | null;
  createdAt: ISODate;
}

export interface InvoiceDto {
  id: string;
  number: string;
  /** Stored status; `displayStatus` adds the derived OVERDUE. */
  status: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "VOID";
  displayStatus: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID";
  customer: Pick<CustomerDto, "id" | "name" | "email" | "phone" | "address">;
  jobId: string | null;
  jobNumber: number | null;
  quoteId: string | null;
  currency: string;
  taxRateBps: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  issueDate: ISODate;
  dueDate: ISODate;
  sentAt: ISODate | null;
  paidAt: ISODate | null;
  voidedAt: ISODate | null;
  voidReason: string | null;
  reminderCount: number;
  lastReminderAt: ISODate | null;
  notes: string | null;
  /** True once the background job has rendered the CURRENT version of the PDF. */
  pdfReady: boolean;
  /** Shareable "view & pay" link (no login). Only for issued invoices. */
  publicUrl: string | null;
  lineItems: LineItemDto[];
  payments: PaymentDto[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface InvoiceSummaryDto {
  outstandingMinor: number;
  overdueMinor: number;
  overdueCount: number;
  paidThisMonthMinor: number;
  currency: string;
}

/** What the public pay page sees: no internal ids, notes about the customer, or audit data. */
export interface PublicInvoiceDto {
  number: string;
  displayStatus: InvoiceDto["displayStatus"];
  business: {
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    logoUrl: string | null;
  };
  customer: { name: string; email: string | null };
  currency: string;
  subtotalMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  issueDate: ISODate;
  dueDate: ISODate;
  paidAt: ISODate | null;
  notes: string | null;
  lineItems: Array<Omit<LineItemDto, "id">>;
  /** False when online payment is switched off for this deployment (pay by transfer instead). */
  canPayOnline: boolean;
  pdfReady: boolean;
}

export interface CheckoutDto {
  /** Where to send the payer (Paystack's hosted page, or the fake provider in dev/tests). */
  authorizationUrl: string;
  reference: string;
}

export const formatQuoteNumber = (n: number): string => `Q-${String(n).padStart(4, "0")}`;
export const formatInvoiceNumber = (n: number): string => `INV-${String(n).padStart(4, "0")}`;

/** Realtime (managers only): an invoice received money. `firstEver` drives the one-time celebration. */
export interface InvoicePaidEvent {
  invoiceId: string;
  number: string;
  customerName: string;
  amountMinor: number;
  currency: string;
  fullyPaid: boolean;
  firstEver: boolean;
}

// ---------------------------------------------------------------------------
// Booking & notifications
// ---------------------------------------------------------------------------

/** What the public booking page needs: no staff names, prices only as configured on services. */
export interface BookingPortalDto {
  business: {
    name: string;
    phone: string | null;
    email: string;
    address: string | null;
    logoUrl: string | null;
  };
  timezone: string;
  currency: string;
  horizonDays: number;
  /** Weekdays the business is open ("mon".."sun"), for greying out the calendar. */
  openDays: string[];
  services: Array<
    Pick<ServiceTypeDto, "id" | "name" | "description" | "defaultDurationMinutes" | "defaultPriceMinor">
  >;
}

export interface AvailabilityDto {
  date: string;
  slots: Array<{ start: ISODate; end: ISODate; available: boolean }>;
}

export interface BookingConfirmationDto {
  reference: string;
  /** Token for the customer's status page (/book/:slug/b/:token). */
  token: string;
}

/**
 * Customer-facing view of a booked job. Deliberately no customer details: a
 * booking can match an existing customer by phone, and the link holder
 * shouldn't see that customer's saved name or address.
 */
export interface BookingStatusDto {
  reference: string;
  status: JobStatus;
  serviceName: string;
  scheduledStart: ISODate | null;
  scheduledEnd: ISODate | null;
  /** First name only, once a technician is assigned. */
  technicianFirstName: string | null;
  business: { name: string; phone: string | null; email: string };
}

export interface NotificationDto {
  id: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  recipient: string;
  template: string;
  subject: string | null;
  body: string;
  status: "QUEUED" | "SENT" | "FAILED";
  attempts: number;
  error: string | null;
  sentAt: ISODate | null;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------
// Developer: API keys & webhooks
// ---------------------------------------------------------------------------

export interface ApiKeyDto {
  id: string;
  name: string;
  /** Shown so a key can be recognised; the full key is never shown again after creation. */
  prefix: string;
  scopes: string[];
  lastUsedAt: ISODate | null;
  expiresAt: ISODate | null;
  revokedAt: ISODate | null;
  createdBy: UserSummaryDto | null;
  createdAt: ISODate;
}

/** Returned ONCE, at creation. */
export interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

export interface WebhookEndpointDto {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  failureCount: number;
  disabledReason: string | null;
  lastDeliveryAt: ISODate | null;
  createdAt: ISODate;
}

/** Returned ONCE, at creation (and when the secret is rotated). */
export interface WebhookEndpointWithSecretDto extends WebhookEndpointDto {
  secret: string;
}

export interface WebhookDeliveryDto {
  id: string;
  eventId: string;
  eventType: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  deliveredAt: ISODate | null;
  createdAt: ISODate;
  payload: unknown;
}

/** The body every webhook POST carries. */
export interface WebhookEnvelope<T = unknown> {
  id: string;
  type: string;
  createdAt: ISODate;
  data: T;
}
