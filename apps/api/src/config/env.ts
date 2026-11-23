import { z } from "zod";

/**
 * Environment is validated once at boot. A typo'd or missing variable fails
 * fast with a readable message instead of surfacing as a runtime bug later.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z
      .string()
      .default("http://localhost:3000")
      .transform((s) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    COOKIE_SECURE: z.stringbool().default(false),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    MAIL_PROVIDER: z.enum(["console"]).default("console"),
    MAIL_FROM: z.string().default("OpsDesk <no-reply@opsdesk.local>"),
    // S3-compatible object storage (MinIO locally). The bucket is private: all
    // access goes through short-lived presigned URLs.
    S3_ENDPOINT: z.url().default("http://localhost:9000"),
    /** Host the BROWSER uses for presigned URLs, if different from S3_ENDPOINT (e.g. inside Docker). */
    S3_PUBLIC_ENDPOINT: z
      .union([z.literal(""), z.url()])
      .optional()
      .transform((v) => v || undefined),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("opsdesk"),
    S3_ACCESS_KEY: z.string().min(1).default("opsdesk"),
    S3_SECRET_KEY: z.string().min(1).default("opsdesk-secret"),
    /**
     * Background jobs. "bullmq" (Redis) in production: the API enqueues, a separate
     * worker process runs them. "inline" runs them in-process right after the request,
     * for tests and Redis-less local dev. Same handlers either way.
     */
    QUEUE_DRIVER: z.enum(["bullmq", "inline"]).optional(),
    /** bullmq only: run the job processors in THIS process (the worker container sets it). */
    RUN_WORKER: z.stringbool().default(false),
    /** Scales every rate limit: raise it for an office where everyone shares one public IP, or for an e2e rig. */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().min(1).max(1000).default(1),
    /** Rate-limit counters: "redis" shares them across API instances (production default). */
    RATE_LIMIT_STORE: z.enum(["memory", "redis"]).optional(),
    /** 32 bytes, base64: encrypts webhook signing secrets at rest. Required in production. */
    DATA_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((v) => !v || Buffer.from(v, "base64").length === 32, "Must be 32 bytes, base64-encoded"),
    /** Let webhooks target http:// and private addresses (local dev/tests only; never in production). */
    WEBHOOKS_ALLOW_PRIVATE: z.stringbool().optional(),
    /** Reverse proxies in front of the API whose X-Forwarded-For we trust (production: 1, Caddy). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Public base URL of the web app: invoice links, payment callbacks, emails. */
    APP_URL: z.url().default("http://localhost:3000"),
    /**
     * "paystack" talks to Paystack. "fake" is an in-app stand-in checkout for local
     * dev, demos and tests: never allowed in production (it marks invoices paid for free).
     */
    PAYMENTS_MODE: z.enum(["paystack", "fake"]).optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.url().default("https://api.paystack.co"),
    SENTRY_DSN: z
      .union([z.literal(""), z.url()])
      .optional()
      .transform((v) => v || undefined),
  })
  .superRefine((env, ctx) => {
    const prod = env.NODE_ENV === "production";
    if (prod && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "Must be true in production" });
    }
    if (prod && env.QUEUE_DRIVER === "inline") {
      ctx.addIssue({ code: "custom", path: ["QUEUE_DRIVER"], message: "Use bullmq in production" });
    }
    if (prod && !env.DATA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["DATA_ENCRYPTION_KEY"],
        message: "Required in production (openssl rand -base64 32)",
      });
    }
    if (prod && env.PAYMENTS_MODE === "fake") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENTS_MODE"],
        message: "The fake provider is not allowed in production",
      });
    }
    if (env.PAYSTACK_SECRET_KEY && !env.PAYSTACK_SECRET_KEY.startsWith("sk_")) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYSTACK_SECRET_KEY"],
        message: "Expected sk_test_... or sk_live_...",
      });
    }
  })
  // Production defaults to Redis and the real gateway; everything else to inline and the fake one.
  .transform((env) => {
    const prod = env.NODE_ENV === "production";
    return {
      ...env,
      QUEUE_DRIVER: env.QUEUE_DRIVER ?? (prod ? "bullmq" : "inline"),
      PAYMENTS_MODE: env.PAYMENTS_MODE ?? (prod ? "paystack" : "fake"),
      RATE_LIMIT_STORE: env.RATE_LIMIT_STORE ?? (prod ? "redis" : "memory"),
      WEBHOOKS_ALLOW_PRIVATE: prod ? false : (env.WEBHOOKS_ALLOW_PRIVATE ?? true),
    } as const;
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** DI token for the validated env object. */
export const ENV = Symbol("ENV");
