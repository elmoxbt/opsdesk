"use client";

import { api, ApiError, type AuthUser, type JobChangedEvent, REALTIME_EVENTS } from "@opsdesk/shared";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { SyncProvider } from "@/offline/sync-provider";
import { SessionContext } from "@/lib/session";

/**
 * Signed-in shell. The session itself is part of the persisted cache, so a
 * technician who opens the app with no signal still gets in (the API enforces
 * auth when they reconnect). Only a definite 401 from the server signs them out.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<AuthUser>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  if (!me.data) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }
  return (
    <SessionContext.Provider value={me.data}>
      <SyncProvider me={me.data}>
        <LiveUpdates me={me.data} />
        {children}
      </SyncProvider>
    </SessionContext.Provider>
  );
}

/** Same Socket.IO feed as the dashboard; the server only sends a technician their own jobs. */
function LiveUpdates({ me }: { me: AuthUser }) {
  const qc = useQueryClient();
  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_REALTIME_URL || undefined, {
      transports: ["websocket"],
      withCredentials: true,
    });
    // Events sent while we were disconnected are gone for good: after a REconnect, refetch everything.
    let connectedBefore = false;
    socket.on("connect", () => {
      if (connectedBefore) void qc.invalidateQueries();
      connectedBefore = true;
    });
    socket.on(REALTIME_EVENTS.jobChanged, (e: JobChangedEvent) => {
      qc.setQueryData(["job", e.job.id], (old: typeof e.job | undefined) =>
        old && old.version > e.job.version ? old : e.job,
      );
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      if (e.kind === "media") void qc.invalidateQueries({ queryKey: ["media", e.job.id] });
      if (e.kind === "parts") void qc.invalidateQueries({ queryKey: ["parts", e.job.id] });
      if (
        e.actor?.id !== me.id &&
        e.job.technician?.id === me.id &&
        (e.kind === "created" || e.kind === "rescheduled")
      ) {
        toast.info(`${e.kind === "created" ? "New job" : "Job updated"}: ${e.job.customer.name}`, {
          description: e.job.serviceType.name,
        });
      }
    });
    return () => void socket.disconnect();
  }, [qc, me.id]);
  return null;
}
