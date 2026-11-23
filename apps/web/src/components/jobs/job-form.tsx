"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  fromZonedInputValue,
  type JobCreateData,
  jobCreateSchema,
  type JobDto,
  toMinor,
  toZonedInputValue,
} from "@opsdesk/shared";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@opsdesk/ui/button";
import { Combobox } from "@opsdesk/ui/combobox";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { Input, NativeSelect, Textarea } from "@opsdesk/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSession } from "@/hooks/use-session";
import { ApiError } from "@/lib/api/client";
import { useCreateJob, useCustomers, useServiceTypes, useTechnicians, useUpdateJob } from "@/lib/api/hooks";
import { money } from "@/lib/format";
import { handleFormError } from "@/lib/forms";

type FormIn = z.input<typeof jobCreateSchema>;
const FIELDS = [
  "customerId",
  "serviceTypeId",
  "technicianId",
  "scheduledStart",
  "scheduledEnd",
  "priceMinor",
  "notes",
  "checklist",
] as const;
export const JOB_FORM_ID = "job-form";

interface JobFormProps {
  job?: JobDto;
  defaultCustomer?: { id: string; name: string };
  onDone: (job: JobDto) => void;
  onPendingChange?: (pending: boolean) => void;
}

/**
 * Create + edit. Validated client-side with the SAME `jobCreateSchema` the API
 * uses. Date inputs read/write in the business's time zone; money is typed in
 * major units and stored as minor units.
 */
export function JobForm({ job, defaultCustomer, onDone, onPendingChange }: JobFormProps) {
  const { organization } = useSession();
  const tz = organization.timezone;
  const [customerSearch, setCustomerSearch] = useState("");
  const q = useDebouncedValue(customerSearch);
  const customers = useCustomers({ q, pageSize: 20 });
  const services = useServiceTypes();
  const technicians = useTechnicians();
  const create = useCreateJob();
  const update = useUpdateJob(job?.id ?? "");

  const form = useForm<FormIn, unknown, JobCreateData>({
    resolver: zodResolver(jobCreateSchema),
    defaultValues: {
      customerId: job?.customer.id ?? defaultCustomer?.id ?? "",
      serviceTypeId: job?.serviceType.id ?? "",
      technicianId: job?.technician?.id ?? null,
      scheduledStart: job?.scheduledStart ?? null,
      scheduledEnd: job?.scheduledEnd ?? null,
      priceMinor: job?.priceMinor ?? null,
      notes: job?.notes ?? "",
      checklist: job?.checklist ?? [],
    },
  });
  const checklist = useFieldArray({ control: form.control, name: "checklist" });
  const { errors } = form.formState;
  const selectedService = services.data?.items.find((s) => s.id === form.watch("serviceTypeId"));

  const onSubmit = form.handleSubmit(async (values) => {
    onPendingChange?.(true);
    try {
      const saved = job
        ? await update.mutateAsync({ ...values, version: job.version })
        : await create.mutateAsync(values);
      toast.success(
        job ? "Job updated" : `Job created${saved.status === "SCHEDULED" ? " and scheduled" : ""}`,
      );
      onDone(saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast.error(e.message);
      else handleFormError(e, form.setError, FIELDS);
    } finally {
      onPendingChange?.(false);
    }
  });

  return (
    <form id={JOB_FORM_ID} onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Customer" required error={errors.customerId?.message}>
        {job ? (
          <Input value={job.customer.name} disabled readOnly />
        ) : (
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
                selectedLabel={defaultCustomer?.name}
                placeholder="Choose a customer"
                emptyText="No customers match. Add them from the Customers page."
                options={(customers.data?.items ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: c.phone,
                }))}
              />
            )}
          />
        )}
      </Field>

      <Field label="Service" required error={errors.serviceTypeId?.message}>
        <NativeSelect {...form.register("serviceTypeId")}>
          <option value="">Choose a service</option>
          {services.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field
        label="Technician"
        error={errors.technicianId?.message}
        hint="Assign a technician and a start time to schedule the job right away."
      >
        <Controller
          control={form.control}
          name="technicianId"
          render={({ field }) => (
            <NativeSelect
              ref={field.ref}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value || null)}
              onBlur={field.onBlur}
            >
              <option value="">Unassigned</option>
              {technicians.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        />
      </Field>

      <FieldGroup>
        <Field label="Start" error={errors.scheduledStart?.message} hint={`Time zone: ${tz}`}>
          <Controller
            control={form.control}
            name="scheduledStart"
            render={({ field }) => (
              <Input
                ref={field.ref}
                type="datetime-local"
                value={toZonedInputValue(field.value as string | null, tz)}
                onChange={(e) => field.onChange(fromZonedInputValue(e.target.value, tz))}
                onBlur={field.onBlur}
              />
            )}
          />
        </Field>
        <Field
          label="End"
          error={errors.scheduledEnd?.message}
          hint={
            selectedService
              ? `Defaults to ${selectedService.defaultDurationMinutes} min`
              : "Defaults to the service duration"
          }
        >
          <Controller
            control={form.control}
            name="scheduledEnd"
            render={({ field }) => (
              <Input
                ref={field.ref}
                type="datetime-local"
                value={toZonedInputValue(field.value as string | null, tz)}
                onChange={(e) => field.onChange(fromZonedInputValue(e.target.value, tz))}
                onBlur={field.onBlur}
              />
            )}
          />
        </Field>
      </FieldGroup>

      <Field
        label={`Price (${organization.currency})`}
        error={errors.priceMinor?.message}
        hint={
          selectedService
            ? `Leave blank for the default: ${money(selectedService.defaultPriceMinor, organization.currency)}`
            : undefined
        }
      >
        <Controller
          control={form.control}
          name="priceMinor"
          render={({ field }) => (
            <Input
              ref={field.ref}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={typeof field.value === "number" ? field.value / 100 : ""}
              onChange={(e) => field.onChange(e.target.value === "" ? null : toMinor(Number(e.target.value)))}
              onBlur={field.onBlur}
              className="font-mono"
            />
          )}
        />
      </Field>

      <Field label="Notes" error={errors.notes?.message}>
        <Textarea
          rows={3}
          placeholder="Access instructions, parking, symptoms…"
          {...form.register("notes")}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Checklist</legend>
        {checklist.fields.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2">
            <Input
              aria-label={`Checklist item ${i + 1}`}
              {...form.register(`checklist.${i}.label`)}
              aria-invalid={!!errors.checklist?.[i]?.label}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove item ${i + 1}`}
              onClick={() => checklist.remove(i)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => checklist.append({ id: crypto.randomUUID().slice(0, 8), label: "", done: false })}
        >
          <Plus aria-hidden /> Add item
        </Button>
      </fieldset>
    </form>
  );
}
