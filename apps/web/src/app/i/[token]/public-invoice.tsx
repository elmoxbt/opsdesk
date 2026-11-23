"use client";

import { api, ApiError, type CheckoutDto, formatMoney, type PublicInvoiceDto } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent } from "@opsdesk/ui/card";
import { Field } from "@opsdesk/ui/field";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Input } from "@opsdesk/ui/input";
import { Logo } from "@opsdesk/ui/logo";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { StatusBadge } from "@opsdesk/ui/status-badge";
import { SuccessCheck } from "@opsdesk/ui/success-check";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, Loader2, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";

const POLL_FOR_MS = 60_000;

/**
 * The customer's view of an invoice: no login, the link is the credential.
 * After checkout the payer lands back here with ?reference=…; we ask the API to
 * verify with the gateway (in case the webhook is still on its way) and poll
 * briefly, so they see "Paid" instead of a stale "Amount due".
 */
export function PublicInvoice({ token }: { token: string }) {
  const config = useClientConfig();
  const router = useRouter();
  const params = useSearchParams();
  const reference = params.get("reference");
  const [confirming, setConfirming] = useState(Boolean(reference));
  const started = useRef(Date.now());

  const invoice = useQuery({
    queryKey: ["public-invoice", token],
    queryFn: () => api<PublicInvoiceDto>(`/public/invoices/${token}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (confirming && d?.displayStatus !== "PAID" && Date.now() - started.current < POLL_FOR_MS)
        return 2000;
      if (d && d.displayStatus !== "DRAFT" && !d.pdfReady) return 3000;
      return false;
    },
  });

  // Returned from checkout: verify once, then let polling pick up the result.
  useEffect(() => {
    if (!reference) return;
    void api(`/public/invoices/${token}/verify`, { method: "POST", body: { reference } })
      .catch(() => undefined)
      .finally(() => void invoice.refetch());
    // Deliberately once per returned reference (not on every refetch identity change).
  }, [reference, token]);

  const paid = invoice.data?.displayStatus === "PAID";
  useEffect(() => {
    if (!confirming) return;
    if (paid) {
      setConfirming(false);
      router.replace(`/i/${token}`, { scroll: false }); // drop ?reference so a reload is clean
    } else if (Date.now() - started.current > POLL_FOR_MS) setConfirming(false);
  }, [paid, confirming, router, token, invoice.dataUpdatedAt]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 sm:py-14">
      <header className="mb-8 flex items-center gap-3">
        {config.branding.logoUrl ? (
          // Plain <img>: the logo is a client-provided asset on any host (next/image needs allow-listed hosts).
          <img src={config.branding.logoUrl} alt="" className="h-8 w-auto" />
        ) : (
          <Logo withText={false} />
        )}
        <span className="font-semibold">{config.business.name}</span>
      </header>
      {invoice.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : invoice.isError ? (
        invoice.error instanceof ApiError && invoice.error.status === 404 ? (
          <EmptyState
            illustration={NotFoundIllustration}
            title="Invoice not found"
            description={`This link isn't valid. Please contact ${config.business.name} at ${config.business.email}.`}
          />
        ) : (
          <ErrorState message={errorMessage(invoice.error)} onRetry={() => void invoice.refetch()} />
        )
      ) : (
        <InvoiceBody invoice={invoice.data} token={token} confirming={confirming && !paid} />
      )}
    </main>
  );
}

function InvoiceBody({
  invoice: inv,
  token,
  confirming,
}: {
  invoice: PublicInvoiceDto;
  token: string;
  confirming: boolean;
}) {
  const config = useClientConfig();
  const m = (minor: number) => formatMoney(minor, inv.currency, config.business.locale);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(config.business.locale, {
      dateStyle: "long",
      timeZone: config.business.timezone,
    }).format(new Date(iso));
  const paid = inv.displayStatus === "PAID";

  const pdf = useMutation({
    mutationFn: () => api<{ url: string }>(`/public/invoices/${token}/pdf`),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-8 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Invoice</p>
            <h1 className="font-mono text-2xl font-semibold">{inv.number}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              For {inv.customer.name} · issued {date(inv.issueDate)}
            </p>
          </div>
          <StatusBadge status={inv.displayStatus} />
        </div>

        {paid ? (
          <div
            className="flex flex-col items-center gap-3 rounded-2xl bg-status-completed/10 p-6 text-center"
            role="status"
          >
            <SuccessCheck />
            <p className="text-lg font-semibold">Paid, thank you!</p>
            <p className="text-sm text-muted-foreground">
              {m(inv.totalMinor)} received{inv.paidAt ? ` on ${date(inv.paidAt)}` : ""}. A receipt is in the
              PDF below.
            </p>
          </div>
        ) : confirming ? (
          <div className="flex items-center gap-3 rounded-2xl border p-5" role="status" aria-live="polite">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm">
              Confirming your payment with the bank. This usually takes a few seconds…
            </p>
          </div>
        ) : inv.displayStatus === "VOID" ? (
          <p className="rounded-2xl border p-5 text-sm">
            This invoice was cancelled. Please contact {config.business.name} if you have questions.
          </p>
        ) : (
          <div className="rounded-2xl bg-muted/50 p-5">
            <p className="text-sm text-muted-foreground">Amount due</p>
            <p className="font-mono text-3xl font-semibold tabular-nums">{m(inv.balanceMinor)}</p>
            <p
              className={`mt-1 text-sm ${inv.displayStatus === "OVERDUE" ? "font-medium text-status-overdue" : "text-muted-foreground"}`}
            >
              {inv.displayStatus === "OVERDUE" ? "Overdue: was due" : "Due"} {date(inv.dueDate)}
            </p>
            {inv.canPayOnline ? (
              <PayForm
                token={token}
                defaultEmail={inv.customer.email ?? ""}
                label={`Pay ${m(inv.balanceMinor)}`}
              />
            ) : (
              <p className="mt-4 text-sm">
                To pay, contact {config.business.name} at {config.business.email}
                {config.business.phone ? ` or ${config.business.phone}` : ""} for transfer details.
              </p>
            )}
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Item</th>
              <th className="pb-2 text-right font-medium">Qty</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lineItems.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 text-right font-mono tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right font-mono tabular-nums">{m(l.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr className="border-t">
              <td colSpan={2} className="pt-3 text-muted-foreground">
                Subtotal
              </td>
              <td className="pt-3 text-right font-mono tabular-nums">{m(inv.subtotalMinor)}</td>
            </tr>
            {inv.taxMinor > 0 && (
              <tr>
                <td colSpan={2} className="text-muted-foreground">
                  Tax ({inv.taxRateBps / 100}%)
                </td>
                <td className="text-right font-mono tabular-nums">{m(inv.taxMinor)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td colSpan={2} className="pt-1">
                Total
              </td>
              <td className="pt-1 text-right font-mono tabular-nums">{m(inv.totalMinor)}</td>
            </tr>
          </tfoot>
        </table>

        {inv.notes && <p className="rounded-lg bg-muted/50 p-3 text-sm">{inv.notes}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-sm text-muted-foreground">
          <span>
            {config.business.name} · {config.business.email}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!inv.pdfReady}
            loading={pdf.isPending}
            onClick={() => pdf.mutate()}
          >
            {inv.pdfReady ? <FileDown aria-hidden /> : <Loader2 className="animate-spin" aria-hidden />}
            {inv.pdfReady ? "Download PDF" : "Preparing PDF…"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PayForm({ token, defaultEmail, label }: { token: string; defaultEmail: string; label: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState<string>();
  const checkout = useMutation({
    mutationFn: () =>
      api<CheckoutDto>(`/public/invoices/${token}/checkout`, { method: "POST", body: { email } }),
    // Full navigation to the gateway's hosted page: card details never touch our app.
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
    onError: (e) =>
      e instanceof ApiError && e.details?.email ? setError(e.details.email[0]) : toast.error(errorMessage(e)),
  });
  return (
    <form
      className="mt-5 space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        checkout.mutate();
      }}
    >
      <Field label="Email for your receipt" required error={error}>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={checkout.isPending || checkout.isSuccess}>
        <Lock aria-hidden /> {label}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Secure checkout. Card details go straight to the payment provider, never to us.
      </p>
    </form>
  );
}
