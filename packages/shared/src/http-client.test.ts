import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, toSearchParams } from "./http-client";

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("toSearchParams", () => {
  it("drops empty values and joins arrays", () => {
    expect(toSearchParams({ q: "", page: 2, status: ["A", "B"], x: undefined, y: null, e: [] })).toBe(
      "?page=2&status=A%2CB",
    );
  });
});

describe("api", () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
  });

  it("throws ApiError with the server's code, message and details", async () => {
    const f = vi.fn(async () =>
      json(400, { error: { code: "VALIDATION_FAILED", message: "Bad", details: { name: ["Required"] } } }),
    );
    await expect(api("/customers", { method: "POST", body: {} }, f)).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      details: { name: ["Required"] },
    });
  });

  it("on 401, refreshes once and retries", async () => {
    let authed = false;
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u);
      if (u === "/api/auth/refresh") {
        authed = true;
        return json(200, {});
      }
      return authed
        ? json(200, { ok: true })
        : json(401, { error: { code: "UNAUTHENTICATED", message: "x" } });
    }) as unknown as typeof fetch;
    await expect(api("/jobs", {}, f)).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["/api/jobs", "/api/auth/refresh", "/api/jobs"]);
  });

  it("concurrent 401s share a single refresh (no token-reuse lockout)", async () => {
    let authed = false;
    let refreshes = 0;
    const f = (async (url: RequestInfo | URL) => {
      if (String(url) === "/api/auth/refresh") {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        authed = true;
        return json(200, {});
      }
      return authed ? json(200, {}) : json(401, { error: { code: "UNAUTHENTICATED", message: "x" } });
    }) as typeof fetch;
    await Promise.all([api("/a", {}, f), api("/b", {}, f), api("/c", {}, f)]);
    expect(refreshes).toBe(1);
  });

  it("does not try to refresh for auth endpoints, and gives up after one retry", async () => {
    const f = vi.fn(async () =>
      json(401, { error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } }),
    );
    await expect(api("/auth/login", { method: "POST", body: {} }, f)).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("api idempotency", () => {
  it("sends Idempotency-Key when given (and keeps it on the post-refresh retry)", async () => {
    const seen: Array<string | null> = [];
    let authed = false;
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/auth/refresh") {
        authed = true;
        return new Response("{}", { status: 200 });
      }
      seen.push(new Headers(init?.headers).get("Idempotency-Key"));
      return authed
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "x" } }), { status: 401 });
    }) as typeof fetch;
    await api("/jobs", { method: "POST", body: {}, idempotencyKey: "k-123456789" }, f);
    expect(seen).toEqual(["k-123456789", "k-123456789"]);
  });
});
