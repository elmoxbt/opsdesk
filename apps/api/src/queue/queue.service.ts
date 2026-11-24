import {
  type BeforeApplicationShutdown,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { ENV, type Env } from "../config/env";

/**
 * Every background job and its payload. Payloads are plain JSON and carry the
 * organizationId explicitly: there is no request (and no tenant context) in a worker.
 */
export interface JobPayloads {
  "invoice.render-pdf": { organizationId: string; invoiceId: string; version: number };
  "invoices.overdue-reminders": Record<string, never>;
  "notification.deliver": { organizationId: string; notificationId: string };
  /** A domain event to fan out to every subscribed webhook endpoint (one delivery each). */
  "webhook.fanout": {
    organizationId: string;
    eventId: string;
    type: string;
    createdAt: string;
    data: unknown;
  };
  "webhook.deliver": { organizationId: string; deliveryId: string };
  /** A job changed in a way the customer should hear about. Snapshot fields make the dedupe key exact. */
  "notification.job": {
    organizationId: string;
    jobId: string;
    message: "scheduled" | "en_route" | "completed" | "cancelled";
    scheduledStart: string | null;
    technicianId: string | null;
  };
}
export type JobName = keyof JobPayloads;
export type JobHandler<N extends JobName> = (payload: JobPayloads[N]) => Promise<void>;

export interface EnqueueOptions {
  /** Same id twice = one job. Used to make "render v3 of this PDF" idempotent. */
  jobId?: string;
}

/** Recurring jobs. Handlers must be safe to run at any time and more than once. */
const SCHEDULES: ReadonlyArray<{ name: JobName; everyMs: number }> = [
  { name: "invoices.overdue-reminders", everyMs: 60 * 60_000 },
];

const QUEUE_NAME = "opsdesk";
const ATTEMPTS = 5;

interface Driver {
  enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts?: EnqueueOptions): Promise<void>;
  start(handlers: Map<JobName, JobHandler<JobName>>): Promise<void>;
  drain(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Inline driver: runs the job in this process right after the current request
 * (never inside it, so a slow PDF doesn't slow the response). Retries like
 * BullMQ does, so handlers are written for retries in both modes.
 */
/**
 * Serverless hosts freeze a function once its response is sent. The serverless
 * entry point registers Vercel's waitUntil here, so inline jobs (PDFs, emails,
 * webhooks) are allowed to finish after the response.
 */
let keepAlive: ((work: Promise<unknown>) => void) | undefined;
export function setBackgroundKeepAlive(fn: (work: Promise<unknown>) => void): void {
  keepAlive = fn;
}

class InlineDriver implements Driver {
  private readonly logger = new Logger("Queue:inline");
  private handlers = new Map<JobName, JobHandler<JobName>>();
  private readonly running = new Set<Promise<void>>();
  private readonly seen = new Set<string>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly schedule: boolean) {}

  async enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    if (opts?.jobId) {
      if (this.seen.has(opts.jobId)) return;
      this.seen.add(opts.jobId);
    }
    const run = new Promise<void>((resolve) => setImmediate(resolve)).then(() =>
      this.runWithRetry(name, payload),
    );
    this.running.add(run);
    keepAlive?.(run);
    void run.finally(() => this.running.delete(run));
  }

  private async runWithRetry(name: JobName, payload: JobPayloads[JobName]): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) return this.logger.warn(`No handler for ${name}; dropped`);
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await handler(payload);
      } catch (e) {
        if (attempt === ATTEMPTS) {
          this.logger.error(`${name} failed after ${ATTEMPTS} attempts: ${String(e)}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
  }

  async start(handlers: Map<JobName, JobHandler<JobName>>): Promise<void> {
    this.handlers = handlers;
    if (!this.schedule) return;
    for (const s of SCHEDULES) {
      const t = setInterval(() => void this.enqueue(s.name, {} as JobPayloads[typeof s.name]), s.everyMs);
      t.unref();
      this.timers.push(t);
    }
  }

  /** Tests: wait until every queued job (and any jobs those enqueue) has finished. */
  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  async close(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.drain();
  }
}

/**
 * BullMQ driver. The API process only produces jobs; the worker container
 * (RUN_WORKER=true) consumes them. Jobs survive restarts, retry with backoff,
 * and failed ones stay inspectable in Redis.
 */
class BullMqDriver implements Driver {
  private readonly logger = new Logger("Queue:bullmq");
  private readonly connection: IORedis;
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(
    redisUrl: string,
    private readonly runWorker: boolean,
  ) {
    // BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: ATTEMPTS,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }

  async enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    await this.queue.add(name, payload, { jobId: opts?.jobId });
  }

  async start(handlers: Map<JobName, JobHandler<JobName>>): Promise<void> {
    if (!this.runWorker) return;
    for (const s of SCHEDULES) {
      // Upsert: every worker (re)declares the schedule; Redis keeps exactly one.
      await this.queue.upsertJobScheduler(s.name, { every: s.everyMs }, { name: s.name, data: {} });
    }
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const handler = handlers.get(job.name as JobName);
        if (!handler) throw new Error(`No handler for ${job.name}`);
        await handler(job.data as JobPayloads[JobName]);
      },
      { connection: this.connection.duplicate(), concurrency: 4 },
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error(`${job?.name} #${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
    this.logger.log(`Worker running: ${[...handlers.keys()].join(", ")}`);
  }

  async drain(): Promise<void> {
    // Not meaningful across processes; tests use the inline driver.
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }
}

/**
 * The only way business code runs work in the background. Processors call
 * `register` in their constructor/onModuleInit; producers call `enqueue`.
 */
@Injectable()
export class QueueService
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly driver: Driver;
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();

  constructor(@Inject(ENV) env: Env) {
    this.driver =
      env.QUEUE_DRIVER === "bullmq"
        ? new BullMqDriver(env.REDIS_URL, env.RUN_WORKER)
        : // No timers in tests or on serverless (cron there is an HTTP trigger: see CronController).
          new InlineDriver(env.NODE_ENV !== "test" && !env.SERVERLESS);
  }

  register<N extends JobName>(name: N, handler: JobHandler<N>): void {
    if (this.handlers.has(name)) throw new Error(`Duplicate handler for ${name}`);
    this.handlers.set(name, handler as JobHandler<JobName>);
  }

  enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    return this.driver.enqueue(name, payload, opts);
  }

  /** Runs a handler directly (tests, ops scripts). */
  async runNow<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for ${name}`);
    await handler(payload);
  }

  drain(): Promise<void> {
    return this.driver.drain();
  }

  // Handlers are registered during module init; start consuming only once all are in.
  onApplicationBootstrap(): Promise<void> {
    return this.driver.start(this.handlers);
  }

  /** Finish in-flight inline jobs while the database is still connected (runs before onModuleDestroy). */
  beforeApplicationShutdown(): Promise<void> {
    return this.driver.drain();
  }

  onApplicationShutdown(): Promise<void> {
    return this.driver.close();
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
