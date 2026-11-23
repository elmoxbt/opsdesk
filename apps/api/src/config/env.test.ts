import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "x".repeat(32),
};

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_ORIGIN).toEqual(["http://localhost:3000"]);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("parses comma-separated origins and string booleans", () => {
    const env = loadEnv({ ...base, WEB_ORIGIN: "http://a.test, http://b.test", COOKIE_SECURE: "true" });
    expect(env.WEB_ORIGIN).toEqual(["http://a.test", "http://b.test"]);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it("fails fast with a readable message", () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("requires secure cookies in production", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(/COOKIE_SECURE/);
  });

  it("defaults the queue to inline outside production and bullmq in production", () => {
    expect(loadEnv(base).QUEUE_DRIVER).toBe("inline");
    const prod = {
      ...base,
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      DATA_ENCRYPTION_KEY: KEY,
      PAYMENTS_MODE: "paystack",
      PAYSTACK_SECRET_KEY: "sk_live_x",
    };
    expect(loadEnv(prod).QUEUE_DRIVER).toBe("bullmq");
    expect(() => loadEnv({ ...prod, QUEUE_DRIVER: "inline" })).toThrow(/QUEUE_DRIVER/);
  });

  it("never allows the fake payment provider in production, and checks the key's shape", () => {
    const prod = { ...base, NODE_ENV: "production", COOKIE_SECURE: "true", DATA_ENCRYPTION_KEY: KEY };
    expect(loadEnv(prod).PAYMENTS_MODE).toBe("paystack");
    expect(loadEnv(base).PAYMENTS_MODE).toBe("fake");
    expect(() => loadEnv({ ...prod, PAYMENTS_MODE: "fake" })).toThrow(/PAYMENTS_MODE/);
    expect(() => loadEnv({ ...base, PAYSTACK_SECRET_KEY: "pk_test_public" })).toThrow(/PAYSTACK_SECRET_KEY/);
  });

  it("production: requires an encryption key, uses Redis for rate limits, never allows private webhook targets", () => {
    const prod = { ...base, NODE_ENV: "production", COOKIE_SECURE: "true" };
    expect(() => loadEnv(prod)).toThrow(/DATA_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...prod, DATA_ENCRYPTION_KEY: "too-short" })).toThrow(/32 bytes/);
    const env = loadEnv({ ...prod, DATA_ENCRYPTION_KEY: KEY, WEBHOOKS_ALLOW_PRIVATE: "true" });
    expect(env.RATE_LIMIT_STORE).toBe("redis");
    expect(env.WEBHOOKS_ALLOW_PRIVATE).toBe(false);
    expect(loadEnv(base)).toMatchObject({ RATE_LIMIT_STORE: "memory", WEBHOOKS_ALLOW_PRIVATE: true });
  });
});
