"use client";

import {
  type AuthUser,
  type DispatchBoardDto,
  formatMoney,
  type InvoicePaidEvent,
  type JobChangedEvent,
  REALTIME_EVENTS,
} from "@opsdesk/shared";
import { Confetti } from "@opsdesk/ui/confetti";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { refreshSession } from "@/lib/api/client";
import { qk } from "@/lib/api/hooks";
import { upsertJobInBoard } from "@/lib/board-cache";

export type RealtimeStatus = "connecting" | "live" | "offline";
const PULSE_MS = 1600;

interface RealtimeState {
  status: RealtimeStatus;
  /** jobId → timestamp of the last change made by SOMEONE ELSE (drives the pulse). */
  pulses: Readonly<Record<string, number>>;
}

const RealtimeContext = createContext<RealtimeState>({ status: "offline", pulses: {} });
export const useRealtime = () => useContext(RealtimeContext);
export const usePulse = (jobId: string): number | undefined => useContext(RealtimeContext).pulses[jobId];

/**
 * One socket per signed-in tab. Incoming job changes are written straight into
 * the TanStack Query cache (detail + any open boards) so every screen updates
 * without refetching; lists are invalidated. After a reconnect we refetch
 * everything job-related, because events may have been missed while offline.
 */
export function RealtimeProvider({ user, children }: { user: AuthUser; children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_REALTIME_URL || undefined; // undefined = same origin
    const socket = io(url, { transports: ["websocket"], withCredentials: true });
    let connectedBefore = false;
    let lastRefresh = 0;

    socket.on("connect", () => {
      setStatus("live");
      if (connectedBefore) void qc.invalidateQueries({ queryKey: ["jobs"] });
      connectedBefore = true;
    });
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", (err) => {
      setStatus("offline");
      // Handshake rejected because the 15-minute access token expired: refresh it
      // (same single-flight refresh the REST client uses), then retry once.
      if (err.message === "UNAUTHENTICATED" && Date.now() - lastRefresh > 10_000) {
        lastRefresh = Date.now();
        void refreshSession().then((ok) => ok && socket.connect());
      }
    });

    socket.on(REALTIME_EVENTS.jobChanged, (e: JobChangedEvent) => {
      qc.setQueryData(qk.job(e.job.id), (old: typeof e.job | undefined) =>
        old && old.version > e.job.version ? old : e.job,
      );
      for (const [key, board] of qc.getQueriesData<DispatchBoardDto>({ queryKey: ["jobs", "board"] })) {
        if (board)
          qc.setQueryData(key, upsertJobInBoard(board, e.job, { from: String(key[2]), to: String(key[3]) }));
      }
      void qc.invalidateQueries({
        queryKey: ["jobs"],
        predicate: (q) => q.queryKey[1] !== "detail" && q.queryKey[1] !== "board",
      });
      void qc.invalidateQueries({ queryKey: ["audit"] });

      if (e.actor?.id !== user.id) {
        const id = e.job.id;
        setPulses((p) => ({ ...p, [id]: Date.now() }));
        clearTimeout(timers.current.get(id));
        timers.current.set(
          id,
          setTimeout(() => setPulses(({ [id]: _, ...rest }) => rest), PULSE_MS),
        );
      }
    });

    // Money in (webhook, or a colleague recording a payment): refresh billing views and say so.
    // Confetti is reserved for the business's FIRST paid invoice ever.
    socket.on(REALTIME_EVENTS.invoicePaid, (e: InvoicePaidEvent) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(e.firstEver ? "Your first paid invoice!" : `Payment received: ${e.number}`, {
        description: `${formatMoney(e.amountMinor, e.currency)} from ${e.customerName}${e.fullyPaid ? " (paid in full)" : ""}`,
      });
      if (e.firstEver) setCelebrate(true);
    });

    const pending = timers.current;
    return () => {
      socket.disconnect();
      for (const t of pending.values()) clearTimeout(t);
    };
  }, [qc, user.id]);

  return (
    <RealtimeContext.Provider value={{ status, pulses }}>
      {children}
      {celebrate && <Confetti onDone={() => setCelebrate(false)} />}
    </RealtimeContext.Provider>
  );
}

export function LiveIndicator() {
  const { status } = useRealtime();
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting…";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {status === "live" && (
          <span className="absolute inset-0 animate-ping rounded-full bg-status-completed opacity-60 motion-reduce:hidden" />
        )}
        <span
          className={`relative size-2 rounded-full ${status === "live" ? "bg-status-completed" : "bg-status-en-route"}`}
        />
      </span>
      {label}
    </span>
  );
}
