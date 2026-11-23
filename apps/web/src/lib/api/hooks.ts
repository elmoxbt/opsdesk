"use client";

import {
  type AnalyticsOverviewDto,
  type ApiKeyDto,
  type ApiKeyInput,
  type CreatedApiKeyDto,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookEndpointInput,
  type WebhookEndpointWithSecretDto,
  type AuditLogDto,
  type AuthUser,
  type CustomerDto,
  type CustomerInput,
  type DispatchBoardDto,
  type InventoryItemDto,
  type InvoiceDto,
  type InvoiceInput,
  type InvoiceSummaryDto,
  type NotificationDto,
  type ManualPaymentInput,
  type QuoteDto,
  type QuoteInput,
  type InventoryItemInput,
  type JobMediaDto,
  type JobPartDto,
  type ScheduleJobInput,
  type UserSummaryDto,
  type InvitationDto,
  type JobCreateInput,
  type JobDto,
  type JobStatsDto,
  type JobTransitionInput,
  type JobUpdateInput,
  type Paginated,
  type ServiceTypeDto,
  type ServiceTypeInput,
  type UserDto,
} from "@opsdesk/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertJobInBoard } from "../board-cache";
import { api, type Query } from "./client";

/** Query keys in one place: invalidation can't drift from the queries it targets. */
export const qk = {
  me: ["me"] as const,
  customers: (q?: Query) => ["customers", q ?? {}] as const,
  customer: (id: string) => ["customers", "detail", id] as const,
  services: (q?: Query) => ["service-types", q ?? {}] as const,
  jobs: (q?: Query) => ["jobs", q ?? {}] as const,
  job: (id: string) => ["jobs", "detail", id] as const,
  jobStats: ["jobs", "stats"] as const,
  users: (q?: Query) => ["users", q ?? {}] as const,
  invitations: ["invitations"] as const,
  audit: (q: Query) => ["audit", q] as const,
};

// ---- Session ----------------------------------------------------------------
export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: () => api<AuthUser>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: () => qc.clear(),
  });
}

// ---- Customers ----------------------------------------------------------------
export const useCustomers = (q: Query) =>
  useQuery({
    queryKey: qk.customers(q),
    queryFn: () => api<Paginated<CustomerDto>>("/customers", { query: q }),
    placeholderData: keepPreviousData,
  });

export const useCustomer = (id: string) =>
  useQuery({ queryKey: qk.customer(id), queryFn: () => api<CustomerDto>(`/customers/${id}`) });

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: CustomerInput }) =>
      id
        ? api<CustomerDto>(`/customers/${id}`, { method: "PUT", body: data })
        : api<CustomerDto>("/customers", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

// ---- Service types ----------------------------------------------------------------
export const useServiceTypes = (q: Query = {}) =>
  useQuery({
    queryKey: qk.services(q),
    queryFn: () => api<Paginated<ServiceTypeDto>>("/service-types", { query: { pageSize: 100, ...q } }),
  });

export function useSaveServiceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: ServiceTypeInput }) =>
      id
        ? api<ServiceTypeDto>(`/service-types/${id}`, { method: "PUT", body: data })
        : api<ServiceTypeDto>("/service-types", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-types"] }),
  });
}

export function useDeleteServiceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/service-types/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-types"] }),
  });
}

// ---- Jobs ----------------------------------------------------------------
export const useJobs = (q: Query) =>
  useQuery({
    queryKey: qk.jobs(q),
    queryFn: () => api<Paginated<JobDto>>("/jobs", { query: q }),
    placeholderData: keepPreviousData,
  });

export const useJob = (id: string) =>
  useQuery({ queryKey: qk.job(id), queryFn: () => api<JobDto>(`/jobs/${id}`) });

export const useJobStats = () =>
  useQuery({ queryKey: qk.jobStats, queryFn: () => api<JobStatsDto>("/jobs/stats") });

/** After any job write: seed the detail cache with the response, refetch lists/stats/timeline. */
function useJobWriteSuccess() {
  const qc = useQueryClient();
  return (job: JobDto) => {
    qc.setQueryData(qk.job(job.id), job);
    void qc.invalidateQueries({ queryKey: ["jobs"], predicate: (q) => q.queryKey[1] !== "detail" });
    void qc.invalidateQueries({ queryKey: ["audit"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
  };
}

export function useCreateJob() {
  const onSuccess = useJobWriteSuccess();
  return useMutation({
    mutationFn: (data: JobCreateInput) => api<JobDto>("/jobs", { method: "POST", body: data }),
    onSuccess,
  });
}

export function useUpdateJob(id: string) {
  const onSuccess = useJobWriteSuccess();
  return useMutation({
    mutationFn: (data: JobUpdateInput) => api<JobDto>(`/jobs/${id}`, { method: "PUT", body: data }),
    onSuccess,
  });
}

export function useTransitionJob(id: string) {
  const onSuccess = useJobWriteSuccess();
  return useMutation({
    mutationFn: (data: JobTransitionInput) =>
      api<JobDto>(`/jobs/${id}/transitions`, { method: "POST", body: data }),
    onSuccess,
  });
}

// ---- Team ----------------------------------------------------------------
export const useUsers = (q: Query = {}) =>
  useQuery({
    queryKey: qk.users(q),
    queryFn: () => api<Paginated<UserDto>>("/users", { query: { pageSize: 100, ...q } }),
  });

export const useTechnicians = (enabled = true) =>
  useQuery({
    queryKey: qk.users({ role: "TECHNICIAN", active: true }),
    queryFn: () =>
      api<Paginated<UserDto>>("/users", { query: { role: "TECHNICIAN", active: true, pageSize: 100 } }),
    enabled,
  });

export const useInvitations = () =>
  useQuery({ queryKey: qk.invitations, queryFn: () => api<InvitationDto[]>("/invitations") });

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role: "DISPATCHER" | "TECHNICIAN" }) =>
      api<InvitationDto>("/invitations", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invitations }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invitations }),
  });
}

export function useChangeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: "DISPATCHER" | "TECHNICIAN" }) =>
      api<UserDto>(`/users/${id}/role`, { method: "PATCH", body: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<UserDto>(`/users/${id}/deactivate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

// ---- Audit ----------------------------------------------------------------
export const useAuditLogs = (q: Query, enabled = true) =>
  useQuery({
    queryKey: qk.audit(q),
    queryFn: () => api<Paginated<AuditLogDto>>("/audit-logs", { query: q }),
    enabled,
  });

// ---- Dispatch board ----------------------------------------------------------------
export const boardKey = (range: { from: string; to: string }) =>
  ["jobs", "board", range.from, range.to] as const;

export const useBoard = (range: { from: string; to: string }) =>
  useQuery({
    queryKey: boardKey(range),
    queryFn: () => api<DispatchBoardDto>("/jobs/board", { query: range }),
    placeholderData: keepPreviousData,
  });

export interface ScheduleVars {
  job: JobDto;
  technician: UserSummaryDto;
  scheduledStart: string;
  scheduledEnd: string;
}

/**
 * Optimistic: the card lands in its new slot immediately; on failure (e.g. a
 * 409 because someone else just took the slot) the snapshot is restored.
 */
export function useScheduleJob(range: { from: string; to: string }) {
  const qc = useQueryClient();
  const key = boardKey(range);
  return useMutation({
    mutationFn: ({ job, technician, scheduledStart, scheduledEnd }: ScheduleVars) =>
      api<JobDto>(`/jobs/${job.id}/schedule`, {
        method: "POST",
        body: {
          technicianId: technician.id,
          scheduledStart,
          scheduledEnd,
          version: job.version,
        } satisfies ScheduleJobInput,
      }),
    onMutate: async ({ job, technician, scheduledStart, scheduledEnd }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DispatchBoardDto>(key);
      if (previous) {
        const optimistic: JobDto = {
          ...job,
          technician,
          scheduledStart,
          scheduledEnd,
          status: job.status === "REQUESTED" ? "SCHEDULED" : job.status,
        };
        qc.setQueryData(key, upsertJobInBoard(previous, optimistic, range));
      }
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (job) => {
      qc.setQueryData(qk.job(job.id), job);
      const current = qc.getQueryData<DispatchBoardDto>(key);
      if (current) qc.setQueryData(key, upsertJobInBoard(current, job, range));
      void qc.invalidateQueries({
        queryKey: ["jobs"],
        predicate: (q) => q.queryKey[1] !== "detail" && q.queryKey[1] !== "board",
      });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

// ---- Field work & inventory (Phase 4) ----------------------------------------------------
export const useJobMedia = (id: string, enabled = true) =>
  useQuery({ queryKey: ["media", id], queryFn: () => api<JobMediaDto>(`/jobs/${id}/media`), enabled });

export const useJobParts = (id: string, enabled = true) =>
  useQuery({ queryKey: ["parts", id], queryFn: () => api<JobPartDto[]>(`/jobs/${id}/parts`), enabled });

export const useInventory = (q: Query) =>
  useQuery({
    queryKey: ["inventory", q],
    queryFn: () => api<Paginated<InventoryItemDto>>("/inventory-items", { query: q }),
    placeholderData: keepPreviousData,
  });

export function useSaveInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: InventoryItemInput }) =>
      id
        ? api<InventoryItemDto>(`/inventory-items/${id}`, { method: "PUT", body: data })
        : api<InventoryItemDto>("/inventory-items", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/inventory-items/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

// ---- Billing ----------------------------------------------------------------
export const billingKeys = {
  invoices: (q?: Query) => ["invoices", q ?? {}] as const,
  invoice: (id: string) => ["invoices", "detail", id] as const,
  summary: ["invoices", "summary"] as const,
  quotes: (q?: Query) => ["quotes", q ?? {}] as const,
};

export const useInvoices = (q: Query, enabled = true) =>
  useQuery({
    queryKey: billingKeys.invoices(q),
    queryFn: () => api<Paginated<InvoiceDto>>("/invoices", { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

/** Polls while the PDF is rendering so "Download PDF" lights up on its own. */
export const useInvoice = (id: string) =>
  useQuery({
    queryKey: billingKeys.invoice(id),
    queryFn: () => api<InvoiceDto>(`/invoices/${id}`),
    refetchInterval: (q) =>
      q.state.data && q.state.data.status !== "DRAFT" && !q.state.data.pdfReady ? 1500 : false,
  });

export const useInvoiceSummary = (enabled = true) =>
  useQuery({
    queryKey: billingKeys.summary,
    queryFn: () => api<InvoiceSummaryDto>("/invoices/summary"),
    enabled,
  });

const isInvoice = (d: unknown): d is InvoiceDto =>
  typeof d === "object" && d !== null && "balanceMinor" in d && "lineItems" in d;

/** Every billing write can change lists, totals and the job it bills: refresh them together. */
function useBillingMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (isInvoice(data)) qc.setQueryData(billingKeys.invoice(data.id), data);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export const useSaveInvoice = () =>
  useBillingMutation(({ id, data }: { id?: string; data: InvoiceInput }) =>
    api<InvoiceDto>(id ? `/invoices/${id}` : "/invoices", { method: id ? "PUT" : "POST", body: data }),
  );
export const useInvoiceFromJob = () =>
  useBillingMutation((jobId: string) =>
    api<InvoiceDto>("/invoices/from-job", { method: "POST", body: { jobId } }),
  );
export const useIssueInvoice = () =>
  useBillingMutation((id: string) => api<InvoiceDto>(`/invoices/${id}/issue`, { method: "POST" }));
export const useResendInvoice = () =>
  useBillingMutation((id: string) => api<InvoiceDto>(`/invoices/${id}/send`, { method: "POST" }));
export const useVoidInvoice = () =>
  useBillingMutation(({ id, reason }: { id: string; reason: string }) =>
    api<InvoiceDto>(`/invoices/${id}/void`, { method: "POST", body: { reason } }),
  );
export const useDeleteInvoice = () =>
  useBillingMutation((id: string) => api<void>(`/invoices/${id}`, { method: "DELETE" }));
/** The key is created per dialog opening, so a double-click or a retry after a timeout records the money once. */
export const useRecordPayment = () =>
  useBillingMutation(({ id, data, key }: { id: string; data: ManualPaymentInput; key: string }) =>
    api<InvoiceDto>(`/invoices/${id}/payments`, { method: "POST", body: data, idempotencyKey: key }),
  );

export const useQuotes = (q: Query) =>
  useQuery({
    queryKey: billingKeys.quotes(q),
    queryFn: () => api<Paginated<QuoteDto>>("/quotes", { query: q }),
    placeholderData: keepPreviousData,
  });
export const useSaveQuote = () =>
  useBillingMutation(({ id, data }: { id?: string; data: QuoteInput }) =>
    api<QuoteDto>(id ? `/quotes/${id}` : "/quotes", { method: id ? "PUT" : "POST", body: data }),
  );
export const useQuoteStatus = () =>
  useBillingMutation(({ id, status }: { id: string; status: "SENT" | "ACCEPTED" | "DECLINED" }) =>
    api<QuoteDto>(`/quotes/${id}/status`, { method: "POST", body: { status } }),
  );
export const useConvertQuote = () =>
  useBillingMutation((id: string) => api<InvoiceDto>(`/quotes/${id}/convert`, { method: "POST" }));

// ---- Notifications (Phase 6) --------------------------------------------------
export const useNotifications = (entityType: "Job" | "Invoice", entityId: string, enabled = true) =>
  useQuery({
    queryKey: ["notifications", entityType, entityId],
    queryFn: () => api<NotificationDto[]>("/notifications", { query: { entityType, entityId } }),
    enabled,
    // Delivery happens in the background: refresh while anything is still queued.
    refetchInterval: (q) => (q.state.data?.some((n) => n.status === "QUEUED") ? 3000 : false),
  });

// ---- Analytics (Phase 7) -------------------------------------------------------
export const useAnalytics = (range: { from: string; to: string }) =>
  useQuery({
    queryKey: ["analytics", range],
    queryFn: () => api<AnalyticsOverviewDto>("/analytics/overview", { query: range }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

// ---- Developers (Phase 8) ------------------------------------------------------
const devKeys = { keys: ["developer", "keys"] as const, hooks: ["developer", "webhooks"] as const };

export const useApiKeys = () =>
  useQuery({ queryKey: devKeys.keys, queryFn: () => api<ApiKeyDto[]>("/developer/api-keys") });

export function useDeveloperMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["developer"] }),
  });
}

export const useCreateApiKey = () =>
  useDeveloperMutation((data: ApiKeyInput) =>
    api<CreatedApiKeyDto>("/developer/api-keys", { method: "POST", body: data }),
  );
export const useRevokeApiKey = () =>
  useDeveloperMutation((id: string) => api<void>(`/developer/api-keys/${id}`, { method: "DELETE" }));

export const useWebhooks = () =>
  useQuery({ queryKey: devKeys.hooks, queryFn: () => api<WebhookEndpointDto[]>("/developer/webhooks") });
export const useSaveWebhook = () =>
  useDeveloperMutation(({ id, data }: { id?: string; data: WebhookEndpointInput }) =>
    id
      ? api<WebhookEndpointDto>(`/developer/webhooks/${id}`, { method: "PUT", body: data })
      : api<WebhookEndpointWithSecretDto>("/developer/webhooks", { method: "POST", body: data }),
  );
export const useDeleteWebhook = () =>
  useDeveloperMutation((id: string) => api<void>(`/developer/webhooks/${id}`, { method: "DELETE" }));
export const useRotateWebhookSecret = () =>
  useDeveloperMutation((id: string) =>
    api<WebhookEndpointWithSecretDto>(`/developer/webhooks/${id}/rotate-secret`, { method: "POST" }),
  );
export const useTestWebhook = () =>
  useDeveloperMutation((id: string) =>
    api<WebhookDeliveryDto>(`/developer/webhooks/${id}/test`, { method: "POST" }),
  );
export const useDeliveries = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [...devKeys.hooks, id, "deliveries"],
    queryFn: () => api<WebhookDeliveryDto[]>(`/developer/webhooks/${id}/deliveries`),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "PENDING") ? 2000 : false),
  });
export const useRedeliver = () =>
  useDeveloperMutation(({ id, deliveryId }: { id: string; deliveryId: string }) =>
    api<void>(`/developer/webhooks/${id}/deliveries/${deliveryId}/redeliver`, { method: "POST" }),
  );
