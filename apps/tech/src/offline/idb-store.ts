import { createStore, del, get, set, values } from "idb-keyval";
import { MemoryOutboxStore } from "./engine";
import type { OutboxEntry, OutboxStore } from "./types";

/**
 * The outbox in IndexedDB (one database per purpose: idb-keyval creates one
 * object store per database). Blobs (photos, signatures) are stored natively,
 * so a photo taken offline survives closing the app.
 */
export class IdbOutboxStore implements OutboxStore {
  private readonly store = createStore("opsdesk-tech-outbox", "entries");
  private readonly listeners = new Set<() => void>();

  all(): Promise<OutboxEntry[]> {
    return values<OutboxEntry>(this.store);
  }
  async put(entry: OutboxEntry): Promise<void> {
    await set(entry.id, entry, this.store);
    this.emit();
  }
  async delete(id: string): Promise<void> {
    await del(id, this.store);
    this.emit();
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
}

class ObservableMemoryStore extends MemoryOutboxStore {
  private readonly listeners = new Set<() => void>();
  override async put(e: OutboxEntry) {
    await super.put(e);
    this.listeners.forEach((fn) => fn());
  }
  override async delete(id: string) {
    await super.delete(id);
    this.listeners.forEach((fn) => fn());
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export type ObservableStore = OutboxStore & { subscribe(fn: () => void): () => void };

/** IndexedDB when available (private browsing on some browsers blocks it: then memory only, with a warning). */
export function createOutboxStore(): { store: ObservableStore; durable: boolean } {
  if (typeof indexedDB === "undefined") return { store: new ObservableMemoryStore(), durable: false };
  return { store: new IdbOutboxStore(), durable: true };
}

/** Storage adapter for TanStack Query's persister: the last-known jobs survive a reload with no signal. */
const cacheStore =
  typeof indexedDB === "undefined" ? undefined : createStore("opsdesk-tech-cache", "queries");
export const queryCacheStorage = {
  getItem: (key: string) =>
    cacheStore ? get<string>(key, cacheStore).then((v) => v ?? null) : Promise.resolve(null),
  setItem: (key: string, value: string) => (cacheStore ? set(key, value, cacheStore) : Promise.resolve()),
  removeItem: (key: string) => (cacheStore ? del(key, cacheStore) : Promise.resolve()),
};
