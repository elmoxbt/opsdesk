"use client";

import { formatJobNumber, type InvoiceDto, MANUAL_PAYMENT_METHODS, toMinor, toMajor } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { ConfirmDialog } from "@opsdesk/ui/confirm-dialog";
import { Dialog } from "@opsdesk/ui/dialog";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Input, NativeSelect, Textarea } from "@opsdesk/ui/input";
import { PageTitle } from "@opsdesk/ui/page-title";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { SuccessCheck } from "@opsdesk/ui/success-check";
import { ArrowLeft, Ban, Banknote, Copy, FileDown, Loader2, Mail, Pencil, Send, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BILLING_FORM_ID, BillingForm } from "@/components/billing/billing-form";
import { NotificationLog } from "@/components/notification-log";
import { useSession } from "@/hooks/use-session";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import {
  useDeleteInvoice,
  useInvoice,
  useIssueInvoice,
  useRecordPayment,
  useResendInvoice,
  useVoidInvoice,
} from "@/lib/api/hooks";
import { formatDateTime, money } from "@/lib/format";

const METHOD_LABEL: Record<(typeof MANUAL_PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  pos: "POS / card terminal",
  other: "Other",
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  if (invoice.isPending) return <DetailSkeleton />;
  if (invoice.isError)
    return invoice.error instanceof ApiError && invoice.error.status === 404 ? (
      <EmptyState
        illustration={NotFoundIllustration}
        title="Invoice not found"
        description="It may have been deleted (drafts can be), or the link is wrong."
        action={
          <Button asChild variant="outline">
            <Link href="/invoices">Back to invoices</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState message={errorMessage(invoice.error)} onRetry={() => void invoice.refetch()} />
    );
  return <InvoiceDetail invoice={invoice.data} />;
}

function InvoiceDetail({ invoice: inv }: { invoice: InvoiceDto }) {
  const user = useSession();
  const config = useClientConfig();
  const router = useRouter();
  const tz = user.organization.timezone;
  const [dialog, setDialog] = useState<"edit" | "pay" | "void" | "delete" | "issue" | null>(null);
  const [saving, setSaving] = useState(false);
  const issue = useIssueInvoice();
  const resend = useResendInvoice();
  const remove = useDeleteInvoice();
  const date = (iso: string | null) => formatDateTime(iso, tz, { timeStyle: undefined });

  // "Paid" moment: when this invoice flips to PAID while open (any channel, incl. realtime).
  const lastStatus = useRef(inv.status);
  const [justPaid, setJustPaid] = useState(false);
  useEffect(() => {
    if (lastStatus.current !== inv.status && inv.status === "PAID") setJustPaid(true);
    lastStatus.current = inv.status;
  }, [inv.status]);

  const open = inv.status === "SENT" || inv.status === "PARTIALLY_PAID";

  const downloadPdf = async () => {
    try {
      const { url } = await api<{ url: string }>(`/invoices/${inv.id}/pdf`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle>{`${inv.number} · ${inv.customer.name}`}</PageTitle>
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Invoices
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{inv.number}</h1>
            <StatusBadge status={inv.displayStatus} />
          </div>
          <p className="text-muted-foreground">
            {inv.customer.name}
            {inv.jobId && inv.jobNumber !== null && (
              <>
                {" · "}
                <Link href={`/jobs/${inv.jobId}`} className="font-mono text-sm hover:underline">
                  {formatJobNumber(inv.jobNumber)}
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {inv.status === "DRAFT" && (
            <>
              <Button variant="outline" onClick={() => setDialog("edit")}>
                <Pencil aria-hidden /> Edit
              </Button>
              <Button variant="outline" onClick={() => setDialog("delete")}>
                <Trash2 aria-hidden /> Delete
              </Button>
              <Button onClick={() => setDialog("issue")}>
                <Send aria-hidden /> Issue &amp; send
              </Button>
            </>
          )}
          {inv.status !== "DRAFT" && (
            <Button variant="outline" onClick={() => void downloadPdf()} disabled={!inv.pdfReady}>
              {inv.pdfReady ? <FileDown aria-hidden /> : <Loader2 className="animate-spin" aria-hidden />}
              {inv.pdfReady ? "PDF" : "Preparing PDF…"}
            </Button>
          )}
          {inv.publicUrl && inv.status !== "VOID" && (
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(inv.publicUrl!)
                  .then(() => toast.success("Pay link copied"))
              }
            >
              <Copy aria-hidden /> Copy pay link
            </Button>
          )}
          {open && inv.customer.email && (
            <Button
              variant="outline"
              loading={resend.isPending}
              onClick={() =>
                resend.mutate(inv.id, {
                  onSuccess: () => toast.success(`Sent to ${inv.customer.email}`),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <Mail aria-hidden /> Resend
            </Button>
          )}
          {open && (
            <Button onClick={() => setDialog("pay")}>
              <Banknote aria-hidden /> Record payment
            </Button>
          )}
          {/* Drafts are deleted, not voided; invoices with money on them need a refund first. */}
          {user.role === "OWNER" && inv.status === "SENT" && inv.amountPaidMinor === 0 && (
            <Button variant="ghost" onClick={() => setDialog("void")}>
              <Ban aria-hidden /> Void
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {justPaid && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-4 rounded-2xl border border-status-completed/30 bg-status-completed/10 p-4"
            role="status"
          >
            <SuccessCheck className="size-12 shrink-0" />
            <div>
              <p className="font-semibold">Paid in full</p>
              <p className="text-sm text-muted-foreground">
                {money(inv.totalMinor, inv.currency)} received
                {inv.jobId ? "; the job is closed as paid." : "."}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {inv.status === "VOID" && (
        <p className="rounded-xl border bg-muted/50 px-4 py-3 text-sm">
          Voided {date(inv.voidedAt)}: {inv.voidReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Unit</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lineItems.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2 pr-2">{l.description}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{l.quantity}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {money(l.unitPriceMinor, inv.currency)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {money(l.totalMinor, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 ml-auto max-w-xs space-y-1 border-t pt-4 text-sm">
              <Total label="Subtotal" value={money(inv.subtotalMinor, inv.currency)} />
              <Total label={`Tax (${inv.taxRateBps / 100}%)`} value={money(inv.taxMinor, inv.currency)} />
              <Total label="Total" value={money(inv.totalMinor, inv.currency)} strong />
              {inv.amountPaidMinor > 0 && (
                <>
                  <Total label="Paid" value={money(inv.amountPaidMinor, inv.currency)} />
                  <Total label="Balance" value={money(inv.balanceMinor, inv.currency)} strong />
                </>
              )}
            </dl>
            {inv.notes && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">{inv.notes}</p>}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Detail
                  label="Bill to"
                  value={[inv.customer.name, inv.customer.email, inv.customer.phone]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <Detail label="Issued" value={inv.sentAt ? date(inv.issueDate) : "Not yet (draft)"} />
                <Detail label="Due" value={date(inv.dueDate)} warn={inv.displayStatus === "OVERDUE"} />
                {inv.paidAt && <Detail label="Paid" value={date(inv.paidAt)} />}
                {inv.reminderCount > 0 && (
                  <Detail
                    label="Reminders"
                    value={`${inv.reminderCount} sent, last ${date(inv.lastReminderAt)}`}
                  />
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {inv.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {config.features.payments && inv.status !== "DRAFT"
                    ? "None yet. The customer can pay online from the link."
                    : "None yet."}
                </p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {p.provider === "MANUAL"
                            ? (METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? "Manual")
                            : p.provider === "FAKE"
                              ? "Online (test)"
                              : "Online (Paystack)"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.status === "SUCCEEDED" ? date(p.paidAt) : p.status.toLowerCase()}
                          {p.note ? ` · ${p.note}` : ""}
                        </p>
                      </div>
                      <span
                        className={`font-mono tabular-nums ${p.status === "SUCCEEDED" ? "" : "text-muted-foreground line-through"}`}
                      >
                        {money(p.amountMinor, p.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <NotificationLog entityType="Invoice" entityId={inv.id} />
        </div>
      </div>

      <Dialog
        open={dialog === "edit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Edit ${inv.number}`}
        className="sm:max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" form={BILLING_FORM_ID} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {dialog === "edit" && (
          <BillingForm
            kind="invoice"
            existing={inv}
            defaultTaxBps={config.business.taxRateBps}
            onPendingChange={setSaving}
            onDone={() => setDialog(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Issue ${inv.number}?`}
        description={
          inv.customer.email
            ? `${inv.customer.email} gets an email with the pay link. Issued invoices can't be edited, only voided.`
            : "This customer has no email: copy the pay link and send it yourself. Issued invoices can't be edited, only voided."
        }
        confirmLabel="Issue invoice"
        loading={issue.isPending}
        onConfirm={() =>
          issue.mutate(inv.id, {
            onSuccess: () => {
              toast.success(`${inv.number} issued`);
              setDialog(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete draft ${inv.number}?`}
        description="Drafts were never sent, so nothing is lost but the draft itself."
        confirmLabel="Delete draft"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(inv.id, {
            onSuccess: () => {
              toast.success("Draft deleted");
              router.push("/invoices");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />

      <PaymentDialog invoice={inv} open={dialog === "pay"} onClose={() => setDialog(null)} />
      <VoidDialog invoice={inv} open={dialog === "void"} onClose={() => setDialog(null)} />
    </div>
  );
}

function PaymentDialog({
  invoice: inv,
  open,
  onClose,
}: {
  invoice: InvoiceDto;
  open: boolean;
  onClose: () => void;
}) {
  const record = useRecordPayment();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof MANUAL_PAYMENT_METHODS)[number]>("bank_transfer");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  // New key per opening: a double-click or a retried request records the money once.
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (open) {
      setAmount(String(toMajor(inv.balanceMinor)));
      setNote("");
      setError(undefined);
      setKey(crypto.randomUUID());
    }
  }, [open, inv.balanceMinor]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const minor = toMinor(Number(amount));
    if (!Number.isFinite(minor) || minor <= 0) return setError("Enter an amount");
    if (minor > inv.balanceMinor) return setError(`At most ${money(inv.balanceMinor, inv.currency)}`);
    record.mutate(
      { id: inv.id, key, data: { amountMinor: minor, method, note: note || null } },
      {
        onSuccess: (updated) => {
          toast.success(updated.status === "PAID" ? `${inv.number} paid in full` : "Payment recorded");
          onClose();
        },
        onError: (err) =>
          err instanceof ApiError && err.details?.amountMinor
            ? setError(err.details.amountMinor[0])
            : toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Record a payment"
      description={`Balance: ${money(inv.balanceMinor, inv.currency)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" loading={record.isPending}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-5" noValidate>
        <FieldGroup className="sm:grid-cols-2">
          <Field label={`Amount (${inv.currency})`} required error={error}>
            <Input
              autoFocus
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              className="font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Method">
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>
        <Field label="Note" hint="e.g. transfer reference">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function VoidDialog({
  invoice: inv,
  open,
  onClose,
}: {
  invoice: InvoiceDto;
  open: boolean;
  onClose: () => void;
}) {
  const voidInvoice = useVoidInvoice();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Void ${inv.number}?`}
      description="The pay link stops accepting payments and the PDF is stamped VOID. A job on it can be invoiced again."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={voidInvoice.isPending}
            disabled={reason.trim().length < 3}
            onClick={() =>
              voidInvoice.mutate(
                { id: inv.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(`${inv.number} voided`);
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Void invoice
          </Button>
        </>
      }
    >
      <Field label="Reason" required hint="Kept in the audit log">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : "text-muted-foreground"}`}>
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={warn ? "font-medium text-status-overdue" : undefined}>{value}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading invoice">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}
