"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CustomerData,
  type CustomerDto,
  type CustomerInput,
  customerInputSchema,
} from "@opsdesk/shared";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { Input, Textarea } from "@opsdesk/ui/input";
import { useSaveCustomer } from "@/lib/api/hooks";
import { handleFormError } from "@/lib/forms";

export const CUSTOMER_FORM_ID = "customer-form";

export function CustomerForm({
  customer,
  onDone,
  onPendingChange,
}: {
  customer?: CustomerDto;
  onDone: (c: CustomerDto) => void;
  onPendingChange?: (p: boolean) => void;
}) {
  const save = useSaveCustomer();
  const form = useForm<CustomerInput, unknown, CustomerData>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: {
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
      email: customer?.email ?? "",
      address: customer?.address ?? "",
      notes: customer?.notes ?? "",
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (data) => {
    onPendingChange?.(true);
    try {
      const saved = await save.mutateAsync({ id: customer?.id, data });
      toast.success(customer ? "Customer updated" : "Customer added");
      onDone(saved);
    } catch (e) {
      handleFormError(e, form.setError, ["name", "phone", "email", "address", "notes"]);
    } finally {
      onPendingChange?.(false);
    }
  });

  return (
    <form id={CUSTOMER_FORM_ID} onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Name" required error={errors.name?.message}>
        <Input autoComplete="off" autoFocus {...form.register("name")} />
      </Field>
      <FieldGroup>
        <Field label="Phone" required error={errors.phone?.message}>
          <Input type="tel" inputMode="tel" placeholder="+234 801 234 5678" {...form.register("phone")} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...form.register("email")} />
        </Field>
      </FieldGroup>
      <Field
        label="Address"
        error={errors.address?.message}
        hint="Technicians get a map link to this address."
      >
        <Textarea rows={2} {...form.register("address")} />
      </Field>
      <Field label="Notes" error={errors.notes?.message}>
        <Textarea rows={3} placeholder="Gate code, pets, preferred times…" {...form.register("notes")} />
      </Field>
    </form>
  );
}
