import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import type { EdgeEvent } from "@pse/domain";
import type { Store } from "@pse/store";
import { Audience, TokenGuard } from "../auth.js";
import { QueueService } from "../engine/queue.service.js";
import { loadSites, SETTINGS, type Settings, STORE } from "../settings.js";
import { METRICS, type Metrics } from "../telemetry/metrics.js";
import { batchSchema } from "./schema.js";

@Controller("v1/edge")
@UseGuards(TokenGuard)
export class IngestController {
  private readonly scannerSite: Map<string, string>;
  private readonly knownSites: Set<string>;

  constructor(
    @Inject(SETTINGS) settings: Settings,
    @Inject(STORE) private readonly store: Store,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {
    const { sites } = loadSites(settings.sitesFile);
    this.scannerSite = new Map(sites.flatMap((s) => s.scanners.map((sc) => [sc.id, s.id] as const)));
    this.knownSites = new Set(sites.map((s) => s.id));
  }

  /**
   * Accepts a batch, stores each event once and queues the new ones. Safe to retry: an event id seen before is
   * acknowledged and dropped, so an edge device that lost the response can resend the whole batch.
   */
  @Post("events")
  @HttpCode(202)
  @Audience("edge")
  async events(@Body() body: unknown): Promise<{ accepted: number; duplicates: number }> {
    const t0 = performance.now();
    const parsed = batchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`));
    const receivedAt = Date.now();
    for (const raw of parsed.data.events) {
      if (raw.kind !== "payment") {
        const owner = this.scannerSite.get(raw.scanner);
        if (owner !== raw.site) throw new UnprocessableEntityException(`scanner ${raw.scanner} is not installed at ${raw.site}`);
      } else if (!this.knownSites.has(raw.site)) {
        throw new UnprocessableEntityException(`unknown site ${raw.site}`);
      }
    }
    const events = parsed.data.events.map((raw) => ({ ...raw, sentAt: receivedAt }) as EdgeEvent);
    const newIds = await this.store.appendEvents(events);
    const seen = new Set<string>();
    const fresh = events.filter((e) => newIds.has(e.id) && !seen.has(e.id) && seen.add(e.id));
    const duplicates = events.length - fresh.length;
    await this.queue.enqueue(fresh);
    this.metrics.inc("events_accepted", fresh.length);
    this.metrics.inc("events_duplicate", duplicates);
    this.metrics.observeIngestMs(performance.now() - t0);
    return { accepted: fresh.length, duplicates };
  }
}
