"use client";

import { api, ApiError, type BookingStatusDto, type JobStatus } from "@opsdesk/shared";
import { Card, CardContent } from "@opsdesk/ui/card";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Logo } from "@opsdesk/ui/logo";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState, ErrorState } from "@opsdesk/ui/states";
import { SuccessCheck } from "@opsdesk/ui/success-check";
import { cn } from "@opsdesk/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { errorMessage } from "@/lib/api/client";

/** The customer's view of the lifecycle: fewer, friendlier stages than the office's. */
const STAGES: Array<{ label: string; reached: readonly JobStatus[] }> = [
  {
    label: "Requested",
    reached: ["REQUESTED", "SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "INVOICED", "PAID"],
  },
  { label: "Confirmed", reached: ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "INVOICED", "PAID"] },
  { label: "On the way", reached: ["EN_ROUTE", "IN_PROGRESS", "COMPLETED", "INVOICED", "PAID"] },
  { label: "In progress", reached: ["IN_PROGRESS", "COMPLETED", "INVOICED", "PAID"] },
  { label: "Done", reached: ["COMPLETED", "INVOICED", "PAID"] },
];

export function BookingStatus({ token }: { token: string }) {
  const config = useClientConfig();
  const booking = useQuery({
    queryKey: ["booking-status", token],
    queryFn: () => api<BookingStatusDto>(`/public/bookings/${token}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    // Gentle polling while the visit is still ahead: "on the way" should appear without a reload.
    refetchInterval: (q) =>
      q.state.data && ["COMPLETED", "INVOICED", "PAID", "CANCELLED"].includes(q.state.data.status)
        ? false
        : 30_000,
  });
  const when = (iso: string) =>
    new Intl.DateTimeFormat(config.business.locale, {
      timeZone: config.business.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex items-center gap-3">
        <Logo withText={false} />
        <span className="font-semibold">{config.business.name}</span>
      </header>
      {booking.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : booking.isError ? (
        booking.error instanceof ApiError && booking.error.status === 404 ? (
          <EmptyState
            illustration={NotFoundIllustration}
            title="Booking not found"
            description={`Check the link in your message, or contact ${config.business.name}.`}
          />
        ) : (
          <ErrorState message={errorMessage(booking.error)} onRetry={() => void booking.refetch()} />
        )
      ) : (
        <Card>
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div>
              <p className="text-sm text-muted-foreground">Booking {booking.data.reference}</p>
              <h1 className="text-xl font-semibold">{booking.data.serviceName}</h1>
              {booking.data.scheduledStart && <p className="mt-1">{when(booking.data.scheduledStart)}</p>}
              {booking.data.technicianFirstName && (
                <p className="text-sm text-muted-foreground">
                  Your technician: {booking.data.technicianFirstName}
                </p>
              )}
            </div>

            {booking.data.status === "CANCELLED" ? (
              <p className="rounded-xl border p-4 text-sm" role="status">
                This booking was cancelled. Please contact us to rebook.
              </p>
            ) : (
              <>
                {STAGES[4]!.reached.includes(booking.data.status) && (
                  <div className="flex items-center gap-3" role="status">
                    <SuccessCheck className="size-10" />
                    <p className="font-medium">
                      All done. Thank you for choosing {booking.data.business.name}!
                    </p>
                  </div>
                )}
                <ol className="space-y-3" aria-label="Progress">
                  {STAGES.map((s) => {
                    const done = s.reached.includes(booking.data.status);
                    return (
                      <li key={s.label} className="flex items-center gap-3 text-sm">
                        <span
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full border transition-colors",
                            done
                              ? "border-transparent bg-primary text-primary-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {done && <Check className="size-3.5" aria-hidden />}
                        </span>
                        <span className={done ? "font-medium" : "text-muted-foreground"}>
                          {s.label}
                          <span className="sr-only">{done ? " (done)" : " (not yet)"}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            <p className="border-t pt-4 text-sm text-muted-foreground">
              Questions? {booking.data.business.phone ? `Call ${booking.data.business.phone} or e` : "E"}mail{" "}
              {booking.data.business.email}.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
