"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  api,
  ApiError,
  type AvailabilityDto,
  type BookingConfirmationDto,
  type BookingData,
  type BookingInput,
  bookingInputSchema,
  type BookingPortalDto,
  formatMoney,
  zonedDateKey,
} from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Card, CardContent } from "@opsdesk/ui/card";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { Field, FieldGroup } from "@opsdesk/ui/field";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Input, Textarea } from "@opsdesk/ui/input";
import { Logo } from "@opsdesk/ui/logo";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { SuccessCheck } from "@opsdesk/ui/success-check";
import { cn } from "@opsdesk/ui/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Check, Clock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { handleFormError } from "@/lib/forms";

type Step = "service" | "time" | "details" | "done";
const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Public booking: service → day and time → details → done. Times are always
 * shown in the business's time zone (the customer books a visit to a place,
 * not a call), and only genuinely free slots are offered. The server re-checks
 * the slot on submit, so a stale page can't double-book.
 */
export function BookingFlow({ slug }: { slug: string }) {
  const config = useClientConfig();
  const [step, setStep] = useState<Step>("service");
  const [serviceId, setServiceId] = useState<string>();
  const [date, setDate] = useState<string>();
  const [start, setStart] = useState<string>();
  const [confirmation, setConfirmation] = useState<BookingConfirmationDto>();

  const portal = useQuery({
    queryKey: ["booking-portal", slug],
    queryFn: () => api<BookingPortalDto>(`/public/booking/${slug}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  const service = portal.data?.services.find((s) => s.id === serviceId);
  const tz = portal.data?.timezone ?? config.business.timezone;
  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat(config.business.locale, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const fmtDay = (key: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(config.business.locale, { timeZone: "UTC", ...opts }).format(
      new Date(`${key}T12:00:00Z`),
    );

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex items-center gap-3">
        {config.branding.logoUrl ? (
          // Plain <img>: client-provided asset on any host.
          <img src={config.branding.logoUrl} alt="" className="h-8 w-auto" />
        ) : (
          <Logo withText={false} />
        )}
        <div>
          <p className="font-semibold">{config.business.name}</p>
          <p className="text-sm text-muted-foreground">Book a visit</p>
        </div>
      </header>

      {portal.isPending ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : portal.isError ? (
        portal.error instanceof ApiError && portal.error.status === 404 ? (
          <EmptyState
            illustration={NotFoundIllustration}
            title="Booking page not found"
            description="Check the link, or contact the business directly."
          />
        ) : (
          <ErrorState message={errorMessage(portal.error)} onRetry={() => void portal.refetch()} />
        )
      ) : (
        <>
          {step !== "done" && <Progress step={step} />}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {step === "service" && (
                <section aria-labelledby="pick-service" className="space-y-3">
                  <h1 id="pick-service" className="text-xl font-semibold">
                    What do you need?
                  </h1>
                  {portal.data.services.length === 0 && (
                    <p className="text-muted-foreground">
                      Online booking isn&apos;t available right now. Please call us.
                    </p>
                  )}
                  {portal.data.services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setServiceId(s.id);
                        setStart(undefined);
                        setStep("time");
                      }}
                      className="motion-press flex w-full items-start justify-between gap-4 rounded-2xl border bg-card p-4 text-left transition-[transform,background-color] duration-150 hover:bg-accent/40 active:scale-[0.99]"
                    >
                      <span>
                        <span className="block font-medium">{s.name}</span>
                        {s.description && (
                          <span className="block text-sm text-muted-foreground">{s.description}</span>
                        )}
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3.5" aria-hidden /> about{" "}
                          {Math.round(s.defaultDurationMinutes / 30) / 2} h
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm tabular-nums">
                        from {formatMoney(s.defaultPriceMinor, portal.data.currency, config.business.locale)}
                      </span>
                    </button>
                  ))}
                </section>
              )}

              {step === "time" && service && (
                <TimeStep
                  slug={slug}
                  portal={portal.data}
                  serviceId={service.id}
                  serviceName={service.name}
                  date={date}
                  start={start}
                  onDate={(d) => {
                    setDate(d);
                    setStart(undefined);
                  }}
                  onStart={setStart}
                  onBack={() => setStep("service")}
                  onNext={() => setStep("details")}
                  fmtTime={fmtTime}
                  fmtDay={fmtDay}
                />
              )}

              {step === "details" && service && start && (
                <DetailsStep
                  slug={slug}
                  serviceId={service.id}
                  summary={`${service.name} · ${fmtDay(zonedDateKey(new Date(start), tz), { weekday: "long", day: "numeric", month: "long" })} at ${fmtTime(start)}`}
                  start={start}
                  onBack={() => setStep("time")}
                  onTaken={() => {
                    setStart(undefined);
                    setStep("time");
                  }}
                  onDone={(c) => {
                    setConfirmation(c);
                    setStep("done");
                  }}
                />
              )}

              {step === "done" && confirmation && service && start && (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 p-8 text-center" role="status">
                    <SuccessCheck />
                    <h1 className="text-xl font-semibold">Booking received</h1>
                    <p className="text-muted-foreground">
                      {service.name} on{" "}
                      {fmtDay(zonedDateKey(new Date(start), tz), {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}{" "}
                      at {fmtTime(start)}. We&apos;ll confirm your technician shortly.
                    </p>
                    <p className="font-mono text-sm">Reference {confirmation.reference}</p>
                    <Button asChild variant="outline">
                      <Link href={`/book/${slug}/b/${confirmation.token}`}>Track your booking</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
      <p className="mt-10 text-center text-xs text-muted-foreground">
        {config.business.name}
        {config.business.phone ? ` · ${config.business.phone}` : ""} · {config.business.email}
      </p>
    </main>
  );
}

function Progress({ step }: { step: Exclude<Step, "done"> }) {
  const steps: Array<[Exclude<Step, "done">, string]> = [
    ["service", "Service"],
    ["time", "Time"],
    ["details", "Your details"],
  ];
  const at = steps.findIndex(([s]) => s === step);
  return (
    <ol className="mb-6 flex gap-2 text-xs" aria-label="Booking steps">
      {steps.map(([s, label], i) => (
        <li
          key={s}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex flex-1 items-center gap-1.5 border-t-2 pt-2",
            i <= at ? "border-primary text-foreground" : "border-border text-muted-foreground",
          )}
        >
          {i < at && <Check className="size-3.5" aria-hidden />}
          {label}
        </li>
      ))}
    </ol>
  );
}

interface TimeStepProps {
  slug: string;
  portal: BookingPortalDto;
  serviceId: string;
  serviceName: string;
  date: string | undefined;
  start: string | undefined;
  onDate(d: string): void;
  onStart(s: string): void;
  onBack(): void;
  onNext(): void;
  fmtTime(iso: string): string;
  fmtDay(key: string, opts: Intl.DateTimeFormatOptions): string;
}

function TimeStep(p: TimeStepProps) {
  const days = useMemo(() => {
    const today = zonedDateKey(new Date(), p.portal.timezone);
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    return Array.from({ length: p.portal.horizonDays + 1 }, (_, i) => {
      const key = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
      const open = p.portal.openDays.includes(WEEKDAY[new Date(`${key}T12:00:00Z`).getUTCDay()]!);
      return { key, open };
    });
  }, [p.portal]);
  const date = p.date ?? days.find((d) => d.open)?.key;

  const availability = useQuery({
    queryKey: ["availability", p.slug, p.serviceId, date],
    queryFn: () =>
      api<AvailabilityDto>(`/public/booking/${p.slug}/availability`, {
        query: { serviceTypeId: p.serviceId, date },
      }),
    enabled: !!date,
    refetchInterval: 60_000, // slots fill up while people browse
  });
  const free = availability.data?.slots.filter((s) => s.available) ?? [];

  return (
    <section aria-labelledby="pick-time" className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={p.onBack} aria-label="Back to services">
          <ArrowLeft aria-hidden />
        </Button>
        <h1 id="pick-time" className="text-xl font-semibold">
          When suits you? <span className="font-normal text-muted-foreground">({p.serviceName})</span>
        </h1>
      </div>

      <div role="radiogroup" aria-label="Day" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            role="radio"
            aria-checked={date === d.key}
            disabled={!d.open}
            onClick={() => p.onDate(d.key)}
            className={cn(
              "flex w-16 shrink-0 flex-col items-center rounded-xl border py-2 text-sm transition-colors disabled:opacity-40",
              date === d.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <span className="text-xs">{p.fmtDay(d.key, { weekday: "short" })}</span>
            <span className="text-lg font-semibold tabular-nums">{p.fmtDay(d.key, { day: "numeric" })}</span>
            <span className="text-xs">{p.fmtDay(d.key, { month: "short" })}</span>
          </button>
        ))}
      </div>

      {availability.isPending ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      ) : availability.isError ? (
        <ErrorState message={errorMessage(availability.error)} onRetry={() => void availability.refetch()} />
      ) : free.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden /> No times left that day. Try another day.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Time" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {availability.data.slots.map((s) => (
            <button
              key={s.start}
              type="button"
              role="radio"
              aria-checked={p.start === s.start}
              disabled={!s.available}
              onClick={() => p.onStart(s.start)}
              className={cn(
                "motion-press h-11 rounded-lg border font-mono text-sm tabular-nums transition-[transform,background-color] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:line-through disabled:opacity-40",
                p.start === s.start ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {p.fmtTime(s.start)}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Times are local to {p.portal.business.name} ({p.portal.timezone}).
      </p>
      <Button className="w-full" size="lg" disabled={!p.start} onClick={p.onNext}>
        Continue
      </Button>
    </section>
  );
}

interface DetailsStepProps {
  slug: string;
  serviceId: string;
  summary: string;
  start: string;
  onBack(): void;
  onTaken(): void;
  onDone(c: BookingConfirmationDto): void;
}

const FIELDS = ["name", "phone", "email", "address", "notes", "start"] as const;

function DetailsStep(p: DetailsStepProps) {
  const form = useForm<BookingInput, unknown, BookingData>({
    resolver: zodResolver(bookingInputSchema),
    defaultValues: {
      serviceTypeId: p.serviceId,
      start: p.start,
      name: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
      website: "",
    },
  });
  const { errors } = form.formState;
  const submit = useMutation({
    mutationFn: (data: BookingData) =>
      api<BookingConfirmationDto>(`/public/booking/${p.slug}`, { method: "POST", body: data }),
    onSuccess: p.onDone,
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(e.message);
        p.onTaken();
      } else handleFormError(e, form.setError, FIELDS);
    },
  });

  return (
    <section aria-labelledby="your-details" className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={p.onBack} aria-label="Back to times">
          <ArrowLeft aria-hidden />
        </Button>
        <div>
          <h1 id="your-details" className="text-xl font-semibold">
            Your details
          </h1>
          <p className="text-sm text-muted-foreground">{p.summary}</p>
        </div>
      </div>
      <form onSubmit={form.handleSubmit((d) => submit.mutate(d))} className="space-y-5" noValidate>
        <FieldGroup className="sm:grid-cols-2">
          <Field label="Name" required error={errors.name?.message}>
            <Input autoComplete="name" autoFocus {...form.register("name")} />
          </Field>
          <Field label="Phone" required error={errors.phone?.message} hint="We'll text you the confirmation">
            <Input type="tel" autoComplete="tel" inputMode="tel" {...form.register("phone")} />
          </Field>
        </FieldGroup>
        <Field label="Email" error={errors.email?.message} hint="Optional, for the confirmation and invoice">
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Address for the visit" required error={errors.address?.message}>
          <Input autoComplete="street-address" {...form.register("address")} />
        </Field>
        <Field label="Anything we should know?" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="Gate code, parking, what's wrong…" {...form.register("notes")} />
        </Field>
        {/* Honeypot: hidden from people (and screen readers); bots fill it in. */}
        <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" {...form.register("website")} />
          </label>
        </div>
        {errors.start?.message && <p className="text-sm text-destructive">{errors.start.message}</p>}
        <Button type="submit" size="lg" className="w-full" loading={submit.isPending}>
          Request booking
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          We only use your details to arrange and invoice this visit.
        </p>
      </form>
    </section>
  );
}
