import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EngineService } from "../engine/engine.service.js";
import { SETTINGS, type Settings } from "../settings.js";
import { METRICS, type Metrics } from "../telemetry/metrics.js";
import { ClaudeCropReader } from "./claude-crop-reader.js";

export const CROP_READER = Symbol("CROP_READER");

/** Offers every queued orphan exit to the crop reader once, before a person gets to it. */
@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AgentService.name);
  private readonly asked = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(EngineService) private readonly engine: EngineService,
    @Inject(CROP_READER) private readonly reader: Pick<ClaudeCropReader, "compare"> | null,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  onModuleInit(): void {
    if (!this.reader || this.settings.role === "ingest") return;
    this.timer = setInterval(() => void this.sweep(), 10_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    if (!this.reader) return 0;
    let n = 0;
    for (const { item } of this.engine.pending()) {
      if (item.kind !== "orphan-exit" || this.asked.has(item.id)) continue;
      this.asked.add(item.id);
      try {
        const answer = await this.reader.compare({ site: item.site, exit: item.exit, candidates: item.candidates });
        if (!answer) continue;
        const r = await this.engine.offerCrop(item.id, answer);
        this.metrics.inc(`crop_${r}`);
        n++;
      } catch (err) {
        this.metrics.inc("crop_errors");
        this.log.warn(`crop reader on ${item.id}: ${(err as Error).message}`);
      }
    }
    return n;
  }
}

export function cropReader(settings: Settings): ClaudeCropReader | null {
  return settings.anthropicKey ? new ClaudeCropReader(settings.anthropicKey, settings.cropModel) : null;
}
