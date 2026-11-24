import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Audience, TokenGuard } from "../auth.js";
import { EngineService } from "../engine/engine.service.js";

@Controller("v1/scanners")
@UseGuards(TokenGuard)
export class ScannersController {
  constructor(@Inject(EngineService) private readonly engine: EngineService) {}

  /** Every scanner: last heartbeat, clock correction, read-quality drift, and the alarms raised. */
  @Get()
  @Audience("operator")
  list(@Query("site") site?: string) {
    return this.engine.scanners(site);
  }
}
