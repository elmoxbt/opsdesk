import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { currentOrganizationId, type Prisma, tenantContext } from "@opsdesk/db";
import type {
  ApiKeyDto,
  CreatedApiKeyDto,
  WebhookDeliveryDto,
  WebhookEndpointDto,
  WebhookEndpointWithSecretDto,
  WebhookEnvelope,
  WebhookEventType,
} from "@opsdesk/shared";
import { apiKeyInputSchema, webhookEndpointInputSchema } from "@opsdesk/shared";
import type { Subscription } from "rxjs";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { hashApiKeySecret } from "../auth/api-key-auth.service";
import type { RequestUser } from "../auth/auth.types";
import { AppException } from "../common/app-exception";
import { iso, isoOrNull } from "../common/mapping";
import { SecretBox } from "../common/secret-box";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DomainEvents } from "../realtime/domain-events";
import { safePost } from "./safe-http";

/** Matches the queue's attempts: after this many failures a delivery is FAILED for good. */
export const MAX_DELIVERY_ATTEMPTS = 5;
/** Consecutive FAILED deliveries before an endpoint is switched off (re-enable from settings). */
export const DISABLE_AFTER_FAILURES = 15;

/** Webhook signature: HMAC-SHA256 over "<timestamp>.<raw body>", like Stripe's. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

const alnum = (n: number) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(n), (b) => chars[b % chars.length]).join("");
};

type ApiKeyData = z.output<typeof apiKeyInputSchema>;
type EndpointData = z.output<typeof webhookEndpointInputSchema>;

/**
 * The `publicApi` feature's owner tools: API keys and outgoing webhooks.
 *
 * Webhooks are at-least-once, signed, and ordered by nothing: receivers
 * dedupe on the event id and use `createdAt`. A domain event becomes a queued
 * fan-out job (durable), which creates one delivery row per subscribed
 * endpoint (unique per endpoint + event, so a replayed fan-out can't double
 * send), each delivered and retried by the worker.
 */
@Injectable()
export class DeveloperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeveloperService.name);
  private readonly box: SecretBox;
  private sub?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly events: DomainEvents,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY, env.JWT_ACCESS_SECRET);
  }

  onModuleInit(): void {
    this.queue.register("webhook.fanout", (p) =>
      tenantContext.runAsync({ organizationId: p.organizationId }, () => this.fanOut(p)),
    );
    this.queue.register("webhook.deliver", (p) =>
      tenantContext.runAsync({ organizationId: p.organizationId }, () => this.deliver(p.deliveryId)),
    );
    this.sub = this.events.stream$.subscribe((e) => {
      const type: WebhookEventType | null =
        e.type === "invoice.paid"
          ? "invoice.paid"
          : e.type === "job.changed"
            ? ((
                {
                  created: "job.created",
                  updated: "job.updated",
                  rescheduled: "job.rescheduled",
                  status_changed: "job.status_changed",
                } as const
              )[e.kind as "created"] ?? null)
            : null;
      if (!type || e.type === "user.deactivated") return;
      const data = e.type === "invoice.paid" ? e.event : e.job;
      this.queue
        .enqueue("webhook.fanout", {
          organizationId: e.organizationId,
          eventId: randomUUID(),
          type,
          createdAt: new Date().toISOString(),
          data,
        })
        .catch((err: unknown) => this.logger.error(`could not queue webhook fan-out: ${String(err)}`));
    });
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ---------------------------------------------------------------------------
  // API keys
  // ---------------------------------------------------------------------------

  async listKeys(): Promise<ApiKeyDto[]> {
    const rows = await this.prisma.db.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      lastUsedAt: isoOrNull(k.lastUsedAt),
      expiresAt: isoOrNull(k.expiresAt),
      revokedAt: isoOrNull(k.revokedAt),
      createdBy: k.createdBy,
      createdAt: iso(k.createdAt),
    }));
  }

  /** The full key exists only in this response. We keep the prefix (lookup) and a SHA-256 of the secret. */
  async createKey(data: ApiKeyData, actor: RequestUser): Promise<CreatedApiKeyDto> {
    const prefix = alnum(12);
    const secret = randomBytes(32).toString("base64url");
    const key = await this.prisma.db.$transaction(async (tx) => {
      const k = await tx.apiKey.create({
        data: {
          organizationId: currentOrganizationId(),
          name: data.name,
          prefix,
          keyHash: hashApiKeySecret(secret),
          scopes: [...new Set(data.scopes)],
          expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
          createdById: actor.id,
        },
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
      });
      await this.audit.record(
        {
          action: "api_key.created",
          entityType: "ApiKey",
          entityId: k.id,
          after: { name: k.name, prefix, scopes: k.scopes },
        },
        tx,
      );
      return k;
    });
    return {
      id: key.id,
      name: key.name,
      prefix,
      scopes: key.scopes,
      lastUsedAt: null,
      expiresAt: isoOrNull(key.expiresAt),
      revokedAt: null,
      createdBy: key.createdBy,
      createdAt: iso(key.createdAt),
      key: `opsk_${prefix}_${secret}`,
    };
  }

  /** Immediate and permanent: the next request with this key gets 401. */
  async revokeKey(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const res = await tx.apiKey.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (res.count === 0) {
        if (!(await tx.apiKey.findUnique({ where: { id }, select: { id: true } })))
          throw new AppException("NOT_FOUND", "API key not found");
        return; // already revoked
      }
      await this.audit.record({ action: "api_key.revoked", entityType: "ApiKey", entityId: id }, tx);
    });
  }

  // ---------------------------------------------------------------------------
  // Webhook endpoints
  // ---------------------------------------------------------------------------

  async listEndpoints(): Promise<WebhookEndpointDto[]> {
    const rows = await this.prisma.db.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toEndpointDto);
  }

  async createEndpoint(data: EndpointData): Promise<WebhookEndpointWithSecretDto> {
    this.assertUrlAllowed(data.url);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const row = await this.prisma.db.$transaction(async (tx) => {
      const e = await tx.webhookEndpoint.create({
        data: {
          organizationId: currentOrganizationId(),
          url: data.url,
          events: [...new Set(data.events)],
          description: data.description ?? null,
          isActive: data.isActive,
          secret: this.box.seal(secret),
        },
      });
      await this.audit.record(
        {
          action: "webhook.created",
          entityType: "WebhookEndpoint",
          entityId: e.id,
          after: { url: e.url, events: e.events },
        },
        tx,
      );
      return e;
    });
    return { ...toEndpointDto(row), secret };
  }

  async updateEndpoint(id: string, data: EndpointData): Promise<WebhookEndpointDto> {
    this.assertUrlAllowed(data.url);
    const before = await this.findEndpoint(id);
    const row = await this.prisma.db.webhookEndpoint.update({
      where: { id },
      data: {
        url: data.url,
        events: [...new Set(data.events)],
        description: data.description ?? null,
        isActive: data.isActive,
        // Turning it back on clears the automatic switch-off.
        ...(data.isActive && !before.isActive ? { failureCount: 0, disabledReason: null } : {}),
      },
    });
    await this.audit.record({
      action: "webhook.updated",
      entityType: "WebhookEndpoint",
      entityId: id,
      before: { url: before.url, events: before.events, isActive: before.isActive },
      after: { url: row.url, events: row.events, isActive: row.isActive },
    });
    return toEndpointDto(row);
  }

  async rotateSecret(id: string): Promise<WebhookEndpointWithSecretDto> {
    await this.findEndpoint(id);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const row = await this.prisma.db.webhookEndpoint.update({
      where: { id },
      data: { secret: this.box.seal(secret) },
    });
    await this.audit.record({
      action: "webhook.secret_rotated",
      entityType: "WebhookEndpoint",
      entityId: id,
    });
    return { ...toEndpointDto(row), secret };
  }

  async deleteEndpoint(id: string): Promise<void> {
    await this.findEndpoint(id);
    await this.prisma.db.webhookEndpoint.delete({ where: { id } });
    await this.audit.record({ action: "webhook.deleted", entityType: "WebhookEndpoint", entityId: id });
  }

  async deliveries(endpointId: string): Promise<WebhookDeliveryDto[]> {
    await this.findEndpoint(endpointId);
    const rows = await this.prisma.db.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((d) => ({
      id: d.id,
      eventId: d.eventId,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      responseBody: d.responseBody,
      error: d.error,
      durationMs: d.durationMs,
      deliveredAt: isoOrNull(d.deliveredAt),
      createdAt: iso(d.createdAt),
      payload: d.payload,
    }));
  }

  /** "Send test event": a `ping` straight to this endpoint, through the normal delivery path. */
  async sendTest(endpointId: string): Promise<WebhookDeliveryDto> {
    await this.findEndpoint(endpointId);
    const envelope: WebhookEnvelope = {
      id: randomUUID(),
      type: "ping",
      createdAt: new Date().toISOString(),
      data: { message: "Hello from OpsDesk" },
    };
    const d = await this.createDelivery(endpointId, envelope);
    await this.deliver(d.id, { once: true });
    return (await this.deliveries(endpointId)).find((x) => x.id === d.id)!;
  }

  /** Send a past delivery again (same event id, so a receiver that already has it can ignore it). */
  async redeliver(endpointId: string, deliveryId: string): Promise<void> {
    const res = await this.prisma.db.webhookDelivery.updateMany({
      where: { id: deliveryId, endpointId, status: { not: "PENDING" } },
      data: { status: "PENDING", attempts: 0, error: null },
    });
    if (res.count === 0) throw new AppException("NOT_FOUND", "Delivery not found (or already being sent)");
    await this.queue.enqueue(
      "webhook.deliver",
      { organizationId: currentOrganizationId(), deliveryId },
      { jobId: `whd-${deliveryId}-${Date.now()}` },
    );
  }

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------

  private async fanOut(p: {
    eventId: string;
    type: string;
    createdAt: string;
    data: unknown;
  }): Promise<void> {
    const endpoints = await this.prisma.db.webhookEndpoint.findMany({
      where: { isActive: true, events: { has: p.type } },
      select: { id: true },
    });
    const envelope: WebhookEnvelope = { id: p.eventId, type: p.type, createdAt: p.createdAt, data: p.data };
    for (const e of endpoints) {
      const d = await this.createDelivery(e.id, envelope);
      await this.queue.enqueue(
        "webhook.deliver",
        { organizationId: currentOrganizationId(), deliveryId: d.id },
        { jobId: `whd-${d.id}` },
      );
    }
  }

  private async createDelivery(endpointId: string, envelope: WebhookEnvelope): Promise<{ id: string }> {
    // Upsert on (endpoint, event): a retried fan-out reuses the row instead of sending twice.
    return this.prisma.db.webhookDelivery.upsert({
      where: { endpointId_eventId: { endpointId, eventId: envelope.id } },
      update: {},
      create: {
        organizationId: currentOrganizationId(),
        endpointId,
        eventId: envelope.id,
        eventType: envelope.type,
        payload: envelope as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  /**
   * One attempt. 2xx = delivered. Anything else records the attempt and throws
   * so the queue retries with backoff, until MAX_DELIVERY_ATTEMPTS, then FAILED.
   * `once` (test sends) records the outcome without retrying.
   */
  async deliver(deliveryId: string, opts: { once?: boolean } = {}): Promise<void> {
    const d = await this.prisma.db.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!d || d.status !== "PENDING") return;
    if (!d.endpoint.isActive && d.eventType !== "ping") {
      await this.prisma.db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "FAILED", error: "Endpoint is switched off" },
      });
      return;
    }
    const body = JSON.stringify(d.payload);
    const t = Math.floor(Date.now() / 1000);
    const attempts = d.attempts + 1;
    let outcome: { ok: boolean; status?: number; body?: string; error?: string; durationMs?: number };
    try {
      const secret = this.box.open(d.endpoint.secret);
      const res = await safePost(
        d.endpoint.url,
        body,
        {
          "Content-Type": "application/json",
          "User-Agent": "OpsDesk-Webhooks/1.0",
          "OpsDesk-Event-Id": d.eventId,
          "OpsDesk-Event-Type": d.eventType,
          "OpsDesk-Signature": `t=${t},v1=${signWebhook(secret, t, body)}`,
        },
        { allowPrivate: this.env.WEBHOOKS_ALLOW_PRIVATE },
      );
      outcome = {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        body: res.body,
        durationMs: res.durationMs,
      };
      if (!outcome.ok) outcome.error = `Receiver answered ${res.status}`;
    } catch (e) {
      outcome = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const final = outcome.ok || opts.once || attempts >= MAX_DELIVERY_ATTEMPTS;
    await this.prisma.db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        attempts,
        responseStatus: outcome.status ?? null,
        responseBody: outcome.body ?? null,
        error: outcome.error ?? null,
        durationMs: outcome.durationMs ?? null,
        ...(outcome.ok
          ? { status: "SUCCEEDED", deliveredAt: new Date() }
          : final
            ? { status: "FAILED" }
            : {}),
      },
    });
    if (outcome.ok) {
      await this.prisma.db.webhookEndpoint.update({
        where: { id: d.endpointId },
        data: { failureCount: 0, lastDeliveryAt: new Date() },
      });
      return;
    }
    if (final) {
      if (d.eventType !== "ping") await this.recordEndpointFailure(d.endpointId);
      return;
    }
    throw new Error(outcome.error); // let the queue retry with backoff
  }

  private async recordEndpointFailure(endpointId: string): Promise<void> {
    const e = await this.prisma.db.webhookEndpoint.update({
      where: { id: endpointId },
      data: { failureCount: { increment: 1 }, lastDeliveryAt: new Date() },
    });
    if (e.failureCount >= DISABLE_AFTER_FAILURES && e.isActive) {
      await this.prisma.db.webhookEndpoint.update({
        where: { id: endpointId },
        data: {
          isActive: false,
          disabledReason: `Switched off after ${e.failureCount} failed deliveries in a row`,
        },
      });
      await this.audit.record({
        action: "webhook.disabled",
        entityType: "WebhookEndpoint",
        entityId: endpointId,
        after: { failures: e.failureCount },
        actorType: "SYSTEM",
      });
    }
  }

  private assertUrlAllowed(url: string): void {
    if (!this.env.WEBHOOKS_ALLOW_PRIVATE && !url.startsWith("https://"))
      throw new AppException("VALIDATION_FAILED", "Webhook URLs must use https", {
        url: ["Use an https:// URL"],
      });
  }

  private async findEndpoint(id: string) {
    const e = await this.prisma.db.webhookEndpoint.findUnique({ where: { id } });
    if (!e) throw new AppException("NOT_FOUND", "Webhook endpoint not found");
    return e;
  }
}

function toEndpointDto(e: {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  failureCount: number;
  disabledReason: string | null;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}): WebhookEndpointDto {
  return {
    id: e.id,
    url: e.url,
    events: e.events,
    description: e.description,
    isActive: e.isActive,
    failureCount: e.failureCount,
    disabledReason: e.disabledReason,
    lastDeliveryAt: isoOrNull(e.lastDeliveryAt),
    createdAt: iso(e.createdAt),
  };
}
