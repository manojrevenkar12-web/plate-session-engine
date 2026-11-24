import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { EdgeEvent } from "@pse/domain";
import { Queue, Worker } from "bullmq";
import { jobId } from "../job-id.js";
import { SETTINGS, type Settings, shardOf } from "../settings.js";
import { EngineService } from "./engine.service.js";

/**
 * Edge events go to one ordered queue per shard of sites. Each queue has exactly one consumer (concurrency 1),
 * because the engine needs a site's events in the order they arrived. Keda scales the consumers on queue length.
 * Without Redis the events go straight to the engine, in the request.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QueueService.name);
  private readonly queues = new Map<number, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(EngineService) private readonly engine: EngineService,
  ) {}

  get inline(): boolean {
    return this.settings.redisUrl === null;
  }

  async onModuleInit(): Promise<void> {
    if (this.inline) return;
    const connection = { url: this.settings.redisUrl!, maxRetriesPerRequest: null };
    for (let s = 0; s < this.settings.shards; s++) this.queues.set(s, new Queue(`edge-${s}`, { connection }));
    if (this.settings.role === "ingest") return;
    const consume = this.settings.role === "engine" ? [this.settings.shard] : [...this.queues.keys()];
    for (const s of consume) {
      const w = new Worker<{ events: EdgeEvent[] }>(`edge-${s}`, async (job) => this.engine.apply(job.data.events), { connection, concurrency: 1 });
      w.on("failed", (job, err) => this.log.error(`edge-${s} job ${job?.id} failed: ${err.message}`));
      this.workers.push(w);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  /** Hands new events on, grouped by shard; job ids make a retried request enqueue nothing twice. */
  async enqueue(events: EdgeEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (this.inline) return this.engine.apply(events);
    const byShard = new Map<number, EdgeEvent[]>();
    for (const e of events) {
      const s = shardOf(e.site, this.settings.shards);
      byShard.set(s, [...(byShard.get(s) ?? []), e]);
    }
    await Promise.all(
      [...byShard.entries()].map(([s, list]) =>
        this.queues.get(s)!.add("events", { events: list }, { jobId: jobId(list.map((e) => e.id).join("|")), removeOnComplete: 1000, removeOnFail: 5000 }),
      ),
    );
  }

  async depth(): Promise<number> {
    let n = 0;
    for (const q of this.queues.values()) n += await q.getWaitingCount();
    return n;
  }
}
