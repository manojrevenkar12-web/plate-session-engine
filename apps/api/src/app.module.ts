import { type DynamicModule, Module } from "@nestjs/common";
import { MemoryStore, PrismaStore, type Store } from "@pse/store";
import { AgentService, CROP_READER, cropReader } from "./agent/agent.service.js";
import type { ClaudeCropReader } from "./agent/claude-crop-reader.js";
import { TokenGuard } from "./auth.js";
import { EngineService } from "./engine/engine.service.js";
import { QueueService } from "./engine/queue.service.js";
import { HealthController } from "./health/health.controller.js";
import { IngestController } from "./ingest/ingest.controller.js";
import { ChargeWorker, PSP_CLIENT, pspClient } from "./payments/charge.worker.js";
import type { PspClient } from "./payments/psp.js";
import { ReviewsController } from "./reviews/reviews.controller.js";
import { ScannersController } from "./scanners/scanners.controller.js";
import { SessionsController } from "./sessions/sessions.controller.js";
import { SETTINGS, type Settings, STORE } from "./settings.js";
import { METRICS, Metrics } from "./telemetry/metrics.js";

export interface Overrides {
  store?: Store;
  psp?: PspClient;
  reader?: Pick<ClaudeCropReader, "compare"> | null;
}

@Module({})
export class AppModule {
  static register(settings: Settings, overrides: Overrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [IngestController, SessionsController, ReviewsController, ScannersController, HealthController],
      providers: [
        { provide: SETTINGS, useValue: settings },
        { provide: STORE, useValue: overrides.store ?? (settings.databaseUrl ? new PrismaStore(settings.databaseUrl) : new MemoryStore()) },
        { provide: PSP_CLIENT, useValue: overrides.psp ?? pspClient(settings) },
        { provide: CROP_READER, useValue: overrides.reader === undefined ? cropReader(settings) : overrides.reader },
        { provide: METRICS, useValue: new Metrics() },
        TokenGuard,
        EngineService,
        QueueService,
        ChargeWorker,
        AgentService,
      ],
    };
  }
}
