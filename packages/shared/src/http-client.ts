import type { ApiErrorBody, ErrorCode } from "./errors";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export function toSearchParams(query: Query = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Sent as `Idempotency-Key`: a retry returns the original response instead of re-applying. */
  idempotencyKey?: string;
  /** Internal: prevents infinite refresh loops. */
  retried?: boolean;
}

/**
 * All refreshes in flight share one promise. When five queries 401 at once
 * (access token expired), we rotate the refresh token ONCE; sending five
 * rotations would trip the server's reuse detection and log the user out.
 */
let refreshing: Promise<boolean> | null = null;
export function refreshSession(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  refreshing ??= fetchImpl("/api/auth/refresh", { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const AUTH_PATHS = ["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout", "/invitations/accept"];

export async function api<T>(
  path: string,
  opts: RequestOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`/api${path}${toSearchParams(opts.query)}`, {
    method: opts.method ?? "GET",
    credentials: "include",
    headers: {
      ...(opts.body !== undefined && { "Content-Type": "application/json" }),
      ...(opts.idempotencyKey && { "Idempotency-Key": opts.idempotencyKey }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.retried && !AUTH_PATHS.some((p) => path.startsWith(p))) {
    if (await refreshSession(fetchImpl)) return api<T>(path, { ...opts, retried: true }, fetchImpl);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? "INTERNAL",
      body?.error.message ?? "Something went wrong. Please try again.",
      body?.error.details,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const errorMessage = (e: unknown): string =>
  e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
