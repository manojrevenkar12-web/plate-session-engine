import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { CropAnswer, EdgeEvent, ReviewAnswer, ReviewItem, Reviewer } from "@pse/domain";
import { ALL_ON, engineConfig, type Outcome, SessionEngine, tariffs } from "@pse/engine";
import type { Store } from "@pse/store";
import { OutboxPsp } from "../payments/psp.js";
import { METRICS, type Metrics } from "../telemetry/metrics.js";
import { tracer } from "../telemetry/tracing.js";
import { loadSites, SETTINGS, type Settings, shardOf, STORE } from "../settings.js";

/** Every review waits for a person: the server never answers one itself. */
class QueueReviewer implements Reviewer {
  resolve(): null {
    return null;
  }
}

/**
 * Owns one engine instance (one shard of sites). The engine is single-threaded by design, so every call goes
 * through one promise chain. Its state is rebuilt on start from the event log and the answers people gave.
 */
@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EngineService.name);
  private engine!: SessionEngine;
  private readonly outbox = new OutboxPsp();
  private chain: Promise<unknown> = Promise.resolve();
  private persisted = 0;
  private timer: NodeJS.Timeout | null = null;
  private onCharge: (key: string) => void = () => {};
  ready = false;
  sites = new Set<string>();

  constructor(
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(STORE) private readonly store: Store,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async onModuleInit(): Promise<void> {
    const { sites, accounts } = loadSites(this.settings.sitesFile);
    const mine = this.settings.role === "engine" ? sites.filter((s) => shardOf(s.id, this.settings.shards) === this.settings.shard) : sites;
    this.sites = new Set(mine.map((s) => s.id));
    this.engine = new SessionEngine(engineConfig(), tariffs(), mine, accounts, { psp: this.outbox, reviewer: new QueueReviewer(), reader: null }, ALL_ON);
    this.metrics.gauge("reviews_waiting", () => (this.ready ? this.engine.pendingReviews().length : 0));
    this.metrics.gauge("scanners_degraded", () => (this.ready ? this.engine.scannerStatus().filter((s) => s.degraded).length : 0));
    this.metrics.gauge("scanners_offline", () => (this.ready ? this.engine.scannerStatus().filter((s) => s.offline).length : 0));
    if (this.settings.role !== "ingest") {
      await this.replay();
      this.timer = setInterval(() => void this.tick(Date.now()), this.settings.tickMs);
      this.timer.unref();
    }
    this.ready = true;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Called by the charge worker to learn about new outbox rows. */
  onNewCharge(f: (key: string) => void): void {
    this.onCharge = f;
  }

  /** Rebuild: events in arrival order, each answer a person gave placed at the time it was given. */
  private async replay(): Promise<void> {
    const answers = await this.store.answers();
    let next = 0;
    let n = 0;
    for await (const e of this.store.events()) {
      if (!this.sites.has(e.site)) continue;
      while (next < answers.length && answers[next]!.at < e.sentAt) {
        const a = answers[next++]!;
        this.engine.answer(a.itemId, a.answer, a.minutes, a.at);
      }
      this.engine.ingest(e);
      n++;
    }
    for (; next < answers.length; next++) {
      const a = answers[next]!;
      this.engine.answer(a.itemId, a.answer, a.minutes, a.at);
    }
    await this.persist();
    if (n > 0) this.log.log(`rebuilt from ${n} events and ${answers.length} answers`);
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.chain.then(f, f);
    this.chain = run.catch(() => undefined);
    return run;
  }

  apply(events: EdgeEvent[]): Promise<void> {
    return this.serial(async () => {
      const span = tracer().startSpan("engine.apply", { attributes: { "pse.events": events.length } });
      try {
        for (const e of events) this.engine.ingest(e);
        await this.persist();
      } finally {
        span.end();
      }
    });
  }

  tick(now: number): Promise<void> {
    return this.serial(async () => {
      this.engine.tick(now);
      await this.persist();
    });
  }

  answer(id: string, answer: ReviewAnswer, minutes: number, operator: string, now = Date.now()): Promise<"applied" | "unknown"> {
    return this.serial(async () => {
      if (!this.engine.pendingReviews().some((p) => p.item.id === id)) return "unknown";
      // Kept before applied: a crash in between replays the answer instead of losing it.
      await this.store.saveAnswer({ itemId: id, answer, minutes, at: now, operator });
      this.engine.answer(id, answer, minutes, now);
      this.metrics.inc("reviews_answered");
      await this.persist();
      return "applied";
    });
  }

  offerCrop(id: string, answer: CropAnswer): Promise<"accepted" | "suggested" | "unknown"> {
    return this.serial(async () => {
      const r = this.engine.offerCropAnswer(id, answer);
      if (r.result === "accepted" && r.resolved) {
        // An accepted crop answer settles a review like a person would, so it is logged and replayed like one.
        await this.store.saveAnswer({ itemId: id, answer: r.resolved, minutes: 0, at: Date.now(), operator: "crop-reader" });
        await this.persist();
      }
      return r.result;
    });
  }

  pending(site?: string): { item: ReviewItem; since: number }[] {
    return this.engine.pendingReviews().filter((p) => !site || p.item.site === site);
  }

  scanners(site?: string) {
    const status = this.engine.scannerStatus().filter((s) => !site || s.site === site);
    const alarms = this.engine.alarms.filter((a) => !site || a.site === site);
    return { status, alarms };
  }

  stats() {
    return { ...this.engine.stats, outcomes: this.engine.outcomes.length };
  }

  outcomesInMemory(): readonly Outcome[] {
    return this.engine.outcomes;
  }

  private async persist(): Promise<void> {
    const fresh = this.engine.outcomes.slice(this.persisted);
    this.persisted = this.engine.outcomes.length;
    for (const o of fresh) {
      if (await this.store.saveOutcome(o)) this.metrics.inc(`outcomes_${o.kind.replace("-", "_")}`);
    }
    for (const c of this.outbox.drain()) {
      const key = c.idempotencyKey!;
      if (await this.store.enqueueCharge({ key, account: c.account, amountCents: c.amountCents, ref: c.ref })) this.onCharge(key);
    }
  }
}
