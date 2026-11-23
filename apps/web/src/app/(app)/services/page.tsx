"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ServiceTypeData,
  type ServiceTypeDto,
  type ServiceTypeInput,
  serviceTypeInputSchema,
  toMinor,
} from "@opsdesk/shared";
import { Clock, MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ServicesIllustration } from "@opsdesk/ui/illustrations";
import { Button } from "@opsdesk/ui/button";
import { Card } from "@opsdesk/ui/card";
import { ConfirmDialog } from "@opsdesk/ui/confirm-dialog";
import { Dialog } from "@opsdesk/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@opsdesk/ui/dropdown-menu";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { Input, Textarea } from "@opsdesk/ui/input";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { AnimatedItem, useFirstLoad } from "@opsdesk/ui/table";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { useDeleteServiceType, useSaveServiceType, useServiceTypes } from "@/lib/api/hooks";
import { money } from "@/lib/format";
import { handleFormError } from "@/lib/forms";
import { cn } from "@opsdesk/ui/utils";
import { PageTitle } from "@opsdesk/ui/page-title";

const FORM_ID = "service-form";
const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

export default function ServicesPage() {
  const user = useSession();
  const isOwner = user.role === "OWNER";
  const services = useServiceTypes({ includeInactive: true });
  const save = useSaveServiceType();
  const remove = useDeleteServiceType();
  const [editing, setEditing] = useState<ServiceTypeDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<ServiceTypeDto | null>(null);
  const [saving, setSaving] = useState(false);
  const animate = useFirstLoad(services.isSuccess);

  const toggleActive = (s: ServiceTypeDto) =>
    save.mutate(
      { id: s.id, data: { ...s, isActive: !s.isActive } },
      {
        onSuccess: () => toast.success(s.isActive ? `${s.name} deactivated` : `${s.name} reactivated`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <div className="space-y-6">
      <PageTitle>Services</PageTitle>
      <PageHeader
        title="Services"
        description="What you offer, with default durations and prices for new jobs."
        actions={
          isOwner && (
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add service
            </Button>
          )
        }
      />

      {services.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : services.isError ? (
        <Card>
          <ErrorState message={errorMessage(services.error)} onRetry={() => void services.refetch()} />
        </Card>
      ) : services.data.items.length === 0 ? (
        <Card>
          <EmptyState
            illustration={ServicesIllustration}
            title="No services yet"
            description={
              isOwner
                ? "Add the services you offer so jobs get the right duration and price."
                : "The owner hasn't added any services yet."
            }
            action={
              isOwner && (
                <Button onClick={() => setEditing("new")}>
                  <Plus aria-hidden /> Add service
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.data.items.map((s, i) => (
            <AnimatedItem key={s.id} index={i} animate={animate}>
              <Card
                className={cn(
                  "flex h-full flex-col p-5 transition-shadow duration-200 hover:shadow-md",
                  !s.isActive && "opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{s.name}</h2>
                    {!s.isActive && (
                      <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  {isOwner && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${s.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(s)}>
                          <Pencil aria-hidden /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => toggleActive(s)}>
                          <Power aria-hidden /> {s.isActive ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(s)}>
                          <Trash2 aria-hidden /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {s.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
                )}
                <div className="mt-auto flex items-center justify-between pt-5 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-4" aria-hidden />
                    {duration(s.defaultDurationMinutes)}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {money(s.defaultPriceMinor, user.organization.currency)}
                  </span>
                </div>
              </Card>
            </AnimatedItem>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "Add service" : "Edit service"}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing !== null && (
          <ServiceForm
            service={editing === "new" ? undefined : editing}
            currency={user.organization.currency}
            onPendingChange={setSaving}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "service"}?`}
        description="Services used by jobs can't be deleted; deactivate them instead to hide them from new jobs."
        confirmLabel="Delete service"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Service deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function ServiceForm({
  service,
  currency,
  onDone,
  onPendingChange,
}: {
  service?: ServiceTypeDto;
  currency: string;
  onDone: () => void;
  onPendingChange: (p: boolean) => void;
}) {
  const save = useSaveServiceType();
  const form = useForm<ServiceTypeInput, unknown, ServiceTypeData>({
    resolver: zodResolver(serviceTypeInputSchema),
    defaultValues: {
      name: service?.name ?? "",
      description: service?.description ?? "",
      defaultDurationMinutes: service?.defaultDurationMinutes ?? 60,
      defaultPriceMinor: service?.defaultPriceMinor ?? 0,
      isActive: service?.isActive ?? true,
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (data) => {
    onPendingChange(true);
    try {
      await save.mutateAsync({ id: service?.id, data });
      toast.success(service ? "Service updated" : "Service added");
      onDone();
    } catch (e) {
      handleFormError(e, form.setError, [
        "name",
        "description",
        "defaultDurationMinutes",
        "defaultPriceMinor",
      ]);
    } finally {
      onPendingChange(false);
    }
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Name" required error={errors.name?.message}>
        <Input autoFocus {...form.register("name")} />
      </Field>
      <Field label="Description" error={errors.description?.message}>
        <Textarea rows={2} {...form.register("description")} />
      </Field>
      <FieldGroup>
        <Field label="Duration (minutes)" required error={errors.defaultDurationMinutes?.message}>
          <Input
            type="number"
            inputMode="numeric"
            min={15}
            step={15}
            className="font-mono"
            {...form.register("defaultDurationMinutes")}
          />
        </Field>
        <Field label={`Price (${currency})`} required error={errors.defaultPriceMinor?.message}>
          <Controller
            control={form.control}
            name="defaultPriceMinor"
            render={({ field }) => (
              <Input
                ref={field.ref}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="font-mono"
                value={typeof field.value === "number" ? field.value / 100 : ""}
                onChange={(e) => field.onChange(e.target.value === "" ? 0 : toMinor(Number(e.target.value)))}
                onBlur={field.onBlur}
              />
            )}
          />
        </Field>
      </FieldGroup>
    </form>
  );
}
