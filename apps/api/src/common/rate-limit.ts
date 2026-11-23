import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  type OnApplicationShutdown,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import IORedis from "ioredis";
import { ENV, type Env } from "../config/env";
import { AppException } from "./app-exception";

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowSec: number;
  /** What the budget is per: the client IP (public/auth routes) or the caller (user/API key). */
  by: "ip" | "caller";
}

export const RATE_LIMIT_KEY = "rateLimit";
/** Per-route budget. Public write endpoints and login carry one. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

/** Every API-key request, on any route: generous for integrations, a ceiling for runaway scripts. */
export const API_KEY_RULE: RateLimitRule = { limit: 120, windowSec: 60, by: "caller" };

interface Hit {
  count: number;
  resetAt: number;
}

interface Store {
  hit(key: string, windowSec: number): Promise<Hit>;
  close(): Promise<void>;
}

/** Fixed window in memory: tests and single-process dev. */
class MemoryStore implements Store {
  private readonly hits = new Map<string, Hit>();
  async hit(key: string, windowSec: number): Promise<Hit> {
    const now = Date.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowSec * 1000 };
      this.hits.set(key, h);
      if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    h.count++;
    return { ...h };
  }
  async close(): Promise<void> {}
}

/**
 * Fixed window in Redis: INCR + PEXPIRE in one round trip (MULTI), so the
 * budget is shared by every API instance and survives restarts.
 */
class RedisStore implements Store {
  constructor(private readonly redis: IORedis) {}
  async hit(key: string, windowSec: number): Promise<Hit> {
    const res = await this.redis
      .multi()
      .incr(key)
      .pexpire(key, windowSec * 1000, "NX")
      .pttl(key)
      .exec();
    const count = Number(res?.[0]?.[1] ?? 1);
    const ttl = Number(res?.[2]?.[1] ?? windowSec * 1000);
    return { count, resetAt: Date.now() + Math.max(0, ttl) };
  }
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Global guard (after auth, so it knows who's calling). Sends the IETF
 * `RateLimit-*` headers on every limited response and `Retry-After` on 429.
 * If Redis is unreachable it fails OPEN (logs, lets the request through):
 * a cache outage shouldn't take the whole API down.
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnApplicationShutdown {
  private readonly store: Store;
  private readonly multiplier: number;

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) env: Env,
  ) {
    this.multiplier = env.RATE_LIMIT_MULTIPLIER;
    this.store =
      env.RATE_LIMIT_STORE === "redis"
        ? new RedisStore(new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }))
        : new MemoryStore();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const route = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const base = route ?? (req.user?.apiKey ? API_KEY_RULE : undefined);
    if (!base) return true;
    const rule = { ...base, limit: base.limit * this.multiplier };

    const who = rule.by === "caller" && req.user ? `c:${req.user.id}` : `ip:${req.ip ?? "unknown"}`;
    const name = route ? `${context.getClass().name}.${context.getHandler().name}` : "apikey";
    let hit: Hit;
    try {
      hit = await this.store.hit(`rl:${name}:${who}`, rule.windowSec);
    } catch {
      return true; // fail open
    }
    const resetSec = Math.max(0, Math.ceil((hit.resetAt - Date.now()) / 1000));
    res.setHeader("RateLimit-Limit", String(rule.limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, rule.limit - hit.count)));
    res.setHeader("RateLimit-Reset", String(resetSec));
    if (hit.count > rule.limit) {
      res.setHeader("Retry-After", String(resetSec));
      const mins = Math.ceil(resetSec / 60);
      throw new AppException(
        "RATE_LIMITED",
        resetSec >= 90
          ? `Too many requests. Try again in ${mins} minutes.`
          : `Too many requests. Try again in ${resetSec} seconds.`,
      );
    }
    return true;
  }

  onApplicationShutdown(): Promise<void> {
    return this.store.close();
  }
}
