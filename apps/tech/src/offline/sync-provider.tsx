"use client";

import { api, ApiError, type AuthUser, type JobDto } from "@opsdesk/shared";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SyncEngine, type SyncState } from "./engine";
import { execute } from "./executor";
import { createOutboxStore } from "./idb-store";
import type { OutboxEntry } from "./types";

type NewEntry = OutboxEntry extends infer E
  ? E extends OutboxEntry
    ? Omit<E, "id" | "userId" | "createdAt" | "attempts" | "state">
    : never
  : never;

interface SyncApi {
  entries: OutboxEntry[];
  state: SyncState;
  online: boolean;
  durable: boolean;
  enqueue(entry: NewEntry): Promise<void>;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  flush(): Promise<void>;
}

const SyncContext = createContext<SyncApi | null>(null);
export function useSync(): SyncApi {
  const s = useContext(SyncContext);
  if (!s) throw new Error("useSync outside SyncProvider");
  return s;
}

const RETRY_EVERY_MS = 20_000;

/**
 * Owns the offline queue for the signed-in technician. Every change goes
 * through `enqueue`, online or not: one code path, so "offline" isn't a
 * special mode that only gets tested on a bad day.
 */
export function SyncProvider({ me, children }: { me: AuthUser; children: ReactNode }) {
  const qc = useQueryClient();
  const [{ store, durable }] = useState(createOutboxStore);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [state, setState] = useState<SyncState>("idle");
  const [online, setOnline] = useState(() => onlineManager.isOnline());

  const engine = useMemo(
    () =>
      new SyncEngine({
        store,
        execute,
        // The resolver's fresh copy of the job also refreshes the screen, so after
        // a conflict the technician sees the real state (e.g. "Cancelled"), not their stale view.
        fetchJob: (id) =>
          api<JobDto>(`/jobs/${id}`)
            .then((job) => {
              qc.setQueryData(["job", job.id], job);
              void qc.invalidateQueries({ queryKey: ["jobs"] });
              return job;
            })
            .catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
        actor: () => ({ id: me.id, role: me.role }),
        onState: setState,
        onApplied: (entry, job) => {
          if (job) qc.setQueryData(["job", job.id], job);
          void qc.invalidateQueries({ queryKey: ["jobs"] });
          if (entry.kind === "photo" || entry.kind === "complete")
            void qc.invalidateQueries({ queryKey: ["media", entry.jobId] });
          if (entry.kind === "addPart" || entry.kind === "removePart") {
            void qc.invalidateQueries({ queryKey: ["parts", entry.jobId] });
            void qc.invalidateQueries({ queryKey: ["inventory"] });
          }
        },
      }),
    [store, me.id, me.role, qc],
  );

  useEffect(() => {
    const refresh = () =>
      void store
        .all()
        .then((all) =>
          setEntries(all.filter((e) => e.userId === me.id).sort((a, b) => a.createdAt - b.createdAt)),
        );
    refresh();
    return store.subscribe(refresh);
  }, [store, me.id]);

  // Sync triggers: start-up, reconnect, app back in the foreground, and a slow timer while anything is waiting.
  useEffect(() => {
    void engine.flush();
    const unsub = onlineManager.subscribe((isOnline) => {
      setOnline(isOnline);
      if (isOnline) void engine.flush();
    });
    const onVisible = () => document.visibilityState === "visible" && void engine.flush();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => void engine.flush(), RETRY_EVERY_MS);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [engine]);

  useEffect(() => {
    if (!durable)
      toast.warning("This browser can't store offline changes (private mode?). Stay online until they sync.");
  }, [durable]);

  const enqueue = useCallback(
    async (partial: NewEntry) => {
      await store.put({
        ...partial,
        id: crypto.randomUUID(),
        userId: me.id,
        createdAt: Date.now(),
        attempts: 0,
        state: "pending",
      } as OutboxEntry);
      void engine.flush();
    },
    [store, engine, me.id],
  );
  const retry = useCallback(
    async (id: string) => {
      const e = (await store.all()).find((x) => x.id === id);
      if (e) await store.put({ ...e, state: "pending", attempts: 0, error: undefined });
      void engine.flush();
    },
    [store, engine],
  );
  const discard = useCallback((id: string) => store.delete(id), [store]);

  const value = useMemo(
    () => ({ entries, state, online, durable, enqueue, retry, discard, flush: () => engine.flush() }),
    [entries, state, online, durable, enqueue, retry, discard, engine],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
