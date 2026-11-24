import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Store } from "@pse/store";
import { Queue, Worker } from "bullmq";
import { EngineService } from "../engine/engine.service.js";
import { jobId } from "../engine/queue.service.js";
import { SETTINGS, type Settings, STORE } from "../settings.js";
import { METRICS, type Metrics } from "../telemetry/metrics.js";
import { HttpPsp, type PspClient, SandboxPsp } from "./psp.js";

export const PSP_CLIENT = Symbol("PSP_CLIENT");

export function pspClient(settings: Settings): PspClient {
  return settings.pspUrl ? new HttpPsp(settings.pspUrl) : new SandboxPsp();
}

/**
 * Drains the charge outbox. Every call carries the charge's key, so a timeout followed by a retry can never take
 * the money twice; BullMQ retries with backoff, and a charge that keeps failing is marked for finance to look at.
 */
@Injectable()
export class ChargeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ChargeWorker.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private draining: Promise<void> = Promise.resolve();

  constructor(
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(STORE) private readonly store: Store,
    @Inject(PSP_CLIENT) private readonly psp: PspClient,
    @Inject(EngineService) private readonly engine: EngineService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.settings.role === "ingest") return;
    if (this.settings.redisUrl) {
      const connection = { url: this.settings.redisUrl, maxRetriesPerRequest: null };
      this.queue = new Queue("charges", { connection });
      this.worker = new Worker<{ key: string }>("charges", async (job) => this.charge(job.data.key, job.attemptsMade + 1), { connection, concurrency: 8 });
      this.engine.onNewCharge((key) => void this.queue!.add("charge", { key }, { jobId: jobId(key), attempts: 6, backoff: { type: "exponential", delay: 2000 } }));
    } else {
      this.engine.onNewCharge(() => void this.drain());
    }
    for (const c of await this.store.pendingCharges(10_000)) {
      if (this.queue) await this.queue.add("charge", { key: c.key }, { jobId: jobId(c.key), attempts: 6, backoff: { type: "exponential", delay: 2000 } });
    }
    if (!this.queue) await this.drain();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Inline mode: charge every pending row now. */
  drain(): Promise<void> {
    this.draining = this.draining.then(async () => {
      for (const c of await this.store.pendingCharges(500)) await this.charge(c.key, c.attempts + 1).catch(() => undefined);
    });
    return this.draining;
  }

  private async charge(key: string, attempt: number): Promise<void> {
    const row = (await this.store.pendingCharges(10_000)).find((c) => c.key === key);
    if (!row) return;
    try {
      const r = await this.psp.charge({ account: row.account, amountCents: row.amountCents, ref: row.ref, idempotencyKey: row.key });
      await this.store.markCharge(key, r === "ok" ? "done" : "failed", attempt);
      this.metrics.inc(r === "ok" ? "charges_done" : "charges_declined");
    } catch (err) {
      this.metrics.inc("charge_attempts_failed");
      await this.store.markCharge(key, "pending", attempt);
      if (attempt >= 6) await this.store.markCharge(key, "failed", attempt);
      this.log.warn(`charge ${key} attempt ${attempt}: ${(err as Error).message}`);
      throw err;
    }
  }
}
