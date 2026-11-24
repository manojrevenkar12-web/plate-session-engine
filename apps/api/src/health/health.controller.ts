import { Controller, Get, Header, Inject, ServiceUnavailableException } from "@nestjs/common";
import { EngineService } from "../engine/engine.service.js";
import { QueueService } from "../engine/queue.service.js";
import { METRICS, type Metrics } from "../telemetry/metrics.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(EngineService) private readonly engine: EngineService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  @Get("healthz")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Ready once the engine has rebuilt its state from the log; Kubernetes sends no traffic before. */
  @Get("readyz")
  ready(): { status: "ready"; stats: ReturnType<EngineService["stats"]> } {
    if (!this.engine.ready) throw new ServiceUnavailableException("rebuilding from the event log");
    return { status: "ready", stats: this.engine.stats() };
  }

  @Get("metrics")
  @Header("content-type", "application/openmetrics-text; version=1.0.0; charset=utf-8")
  async metricsText(): Promise<string> {
    this.metrics.gauge("queue_depth", () => this.lastDepth);
    this.lastDepth = this.queue.inline ? 0 : await this.queue.depth();
    return this.metrics.render();
  }

  private lastDepth = 0;
}
