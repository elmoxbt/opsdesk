"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  computeTotals,
  type InvoiceDto,
  invoiceInputSchema,
  type QuoteDto,
  quoteInputSchema,
  toMinor,
  zonedDateKey,
} from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Combobox } from "@opsdesk/ui/combobox";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { Input, Textarea } from "@opsdesk/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSession } from "@/hooks/use-session";
import { useCustomers, useSaveInvoice, useSaveQuote } from "@/lib/api/hooks";
import { money } from "@/lib/format";
import { handleFormError } from "@/lib/forms";

export const BILLING_FORM_ID = "billing-form";

/**
 * One form for quotes and invoices (same shape: customer, lines, tax, a date,
 * notes). Validated with the shared schema, so the browser and the API reject
 * the same things; the totals preview uses the same `computeTotals` as the
 * server, so what you see is exactly what gets billed.
 */
const formSchema = z.object({
  customerId: z.string().min(1, "Choose a customer"),
  lineItems: invoiceInputSchema.shape.lineItems,
  /** Edited as a percentage; sent as basis points. */
  taxPercent: z.coerce.number().min(0, "Can't be negative").max(100),
  date: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
type FormIn = z.input<typeof formSchema>;
type FormOut = z.output<typeof formSchema>;

interface Props {
  kind: "invoice" | "quote";
  existing?: InvoiceDto | QuoteDto;
  defaultTaxBps: number;
  onDone: (saved: InvoiceDto | QuoteDto) => void;
  onPendingChange: (pending: boolean) => void;
}

export function BillingForm({ kind, existing, defaultTaxBps, onDone, onPendingChange }: Props) {
  const { organization } = useSession();
  const currency = organization.currency;
  const [customerSearch, setCustomerSearch] = useState("");
  const customers = useCustomers({ q: useDebouncedValue(customerSearch), pageSize: 20 });
  const saveInvoice = useSaveInvoice();
  const saveQuote = useSaveQuote();
  const existingDate =
    existing && "dueDate" in existing
      ? existing.dueDate
      : existing && "validUntil" in existing
        ? existing.validUntil
        : null;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerId: existing?.customer.id ?? "",
      lineItems: existing?.lineItems.map(({ description, quantity, unitPriceMinor }) => ({
        description,
        quantity,
        unitPriceMinor,
      })) ?? [{ description: "", quantity: 1, unitPriceMinor: 0 }],
      taxPercent: (existing?.taxRateBps ?? defaultTaxBps) / 100,
      date: existingDate ? zonedDateKey(new Date(existingDate), organization.timezone) : "",
      notes: existing?.notes ?? "",
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lineItems" });
  const { errors } = form.formState;

  const watched = useWatch({ control: form.control, name: ["lineItems", "taxPercent"] });
  const preview = (() => {
    try {
      const items = (watched[0] ?? []).map((l) => ({
        quantity: Math.max(0, Math.trunc(Number(l.quantity) || 0)),
        unitPriceMinor: Math.max(0, Math.trunc(Number(l.unitPriceMinor) || 0)),
      }));
      return computeTotals(items, Math.round((Number(watched[1]) || 0) * 100));
    } catch {
      return null;
    }
  })();

  const onSubmit = form.handleSubmit(async (v) => {
    onPendingChange(true);
    const common = {
      customerId: v.customerId,
      lineItems: v.lineItems,
      taxRateBps: Math.round(v.taxPercent * 100),
      notes: v.notes || null,
    };
    try {
      const saved =
        kind === "invoice"
          ? await saveInvoice.mutateAsync({
              id: existing?.id,
              data: invoiceInputSchema.parse({ ...common, dueDate: v.date || null }),
            })
          : await saveQuote.mutateAsync({
              id: existing?.id,
              data: quoteInputSchema.parse({ ...common, validUntil: v.date || null }),
            });
      toast.success(
        existing ? "Saved" : `${kind === "invoice" ? "Invoice" : "Quote"} ${saved.number} created`,
      );
      onDone(saved);
    } catch (e) {
      handleFormError(e, form.setError, ["customerId", "date", "notes"]);
    } finally {
      onPendingChange(false);
    }
  });

  return (
    <form id={BILLING_FORM_ID} onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Customer" required error={errors.customerId?.message}>
        <Controller
          control={form.control}
          name="customerId"
          render={({ field }) => (
            <Combobox
              ref={field.ref}
              value={field.value || null}
              onChange={field.onChange}
              search={customerSearch}
              onSearch={setCustomerSearch}
              loading={customers.isFetching}
              selectedLabel={existing?.customer.name}
              placeholder="Choose a customer"
              emptyText="No customers match."
              options={(customers.data?.items ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                hint: c.phone,
              }))}
            />
          )}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Line items</legend>
        <div className="hidden grid-cols-[1fr_5rem_8rem_7rem_2.5rem] gap-2 px-1 text-xs text-muted-foreground sm:grid">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price ({currency})</span>
          <span className="text-right">Amount</span>
        </div>
        {lines.fields.map((f, i) => {
          const e = errors.lineItems?.[i];
          return (
            <div
              key={f.id}
              className="grid grid-cols-[5rem_1fr_2.5rem] gap-2 sm:grid-cols-[1fr_5rem_8rem_7rem_2.5rem]"
            >
              <div className="col-span-3 sm:col-span-1">
                <Input
                  aria-label={`Line ${i + 1} description`}
                  aria-invalid={!!e?.description}
                  placeholder="e.g. Generator servicing"
                  {...form.register(`lineItems.${i}.description`)}
                />
                {e?.description && <p className="mt-1 text-xs text-destructive">{e.description.message}</p>}
              </div>
              <Input
                aria-label={`Line ${i + 1} quantity`}
                aria-invalid={!!e?.quantity}
                type="number"
                inputMode="numeric"
                min={1}
                className="font-mono"
                {...form.register(`lineItems.${i}.quantity`)}
              />
              <Controller
                control={form.control}
                name={`lineItems.${i}.unitPriceMinor`}
                render={({ field }) => (
                  <Input
                    ref={field.ref}
                    aria-label={`Line ${i + 1} unit price`}
                    aria-invalid={!!e?.unitPriceMinor}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="font-mono"
                    value={typeof field.value === "number" ? field.value / 100 : ""}
                    onChange={(ev) =>
                      field.onChange(ev.target.value === "" ? 0 : toMinor(Number(ev.target.value)))
                    }
                    onBlur={field.onBlur}
                  />
                )}
              />
              <span className="hidden items-center justify-end font-mono text-sm tabular-nums sm:flex">
                {money(preview?.lines[i]?.totalMinor ?? 0, currency)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.fields.length === 1}
                onClick={() => lines.remove(i)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          );
        })}
        {errors.lineItems?.root?.message || errors.lineItems?.message ? (
          <p className="text-xs text-destructive">
            {errors.lineItems.root?.message ?? errors.lineItems.message}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => lines.append({ description: "", quantity: 1, unitPriceMinor: 0 })}
        >
          <Plus aria-hidden /> Add line
        </Button>
      </fieldset>

      <FieldGroup className="sm:grid-cols-2">
        <Field label="Tax (%)" error={errors.taxPercent?.message}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            className="font-mono"
            {...form.register("taxPercent")}
          />
        </Field>
        <Field
          label={kind === "invoice" ? "Due date" : "Valid until"}
          hint={existing ? undefined : "Leave empty for the default terms"}
          error={errors.date?.message}
        >
          <Input type="date" {...form.register("date")} />
        </Field>
      </FieldGroup>

      <Field label="Notes" hint="Shown to the customer" error={errors.notes?.message}>
        <Textarea rows={2} {...form.register("notes")} />
      </Field>

      {preview && (
        <dl className="ml-auto w-full max-w-xs space-y-1 rounded-xl bg-muted/50 p-4 text-sm">
          <Row label="Subtotal" value={money(preview.subtotalMinor, currency)} />
          <Row label="Tax" value={money(preview.taxMinor, currency)} />
          <Row label="Total" value={money(preview.totalMinor, currency)} strong />
        </dl>
      )}
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between ${strong ? "border-t pt-2 font-semibold" : "text-muted-foreground"}`}
    >
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
