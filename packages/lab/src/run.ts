import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOUR, MINUTE } from "@pse/domain";
import { ALL_ON, type EngineOptions, engineConfig, ROOT, SessionEngine, tariffs } from "@pse/engine";
import { SimulatedCropReader, SimulatedOperator, SimulatedPsp, type World } from "@pse/world";
import { BaselineDesk, type BaselineMode } from "./baselines.js";
import { type Score, score } from "./score.js";

export interface DesignSpec {
  label: string;
  baseline?: BaselineMode;
  engine?: Partial<EngineOptions>;
}

export interface Designs {
  main: string[];
  ablations: string[];
  designs: Record<string, DesignSpec>;
}

export function designs(): Designs {
  return JSON.parse(readFileSync(join(ROOT, "config", "designs.json"), "utf8")) as Designs;
}

export interface RunResult {
  score: Score;
  events: number;
  ms: number;
}

/** Plays one design through one world. Every design gets its own copy of each actor, on the same luck. */
export function runDesign(world: World, spec: DesignSpec): RunResult {
  const cfg = engineConfig();
  const tariff = tariffs();
  const psp = new SimulatedPsp(world);
  const operator = new SimulatedOperator(world);
  const reader = new SimulatedCropReader(world);
  const t0 = performance.now();
  if (spec.baseline) {
    const desk = new BaselineDesk(spec.baseline, tariff, world.sites, world.accounts, psp, spec.baseline === "model" ? reader : null);
    for (const e of world.events) desk.ingest(e);
    const ms = performance.now() - t0;
    const s = score(world, desk.outcomes, psp, { operatorMinutes: 0, reviews: 0, modelCalls: reader.calls, agentAccepted: 0, alarms: [] });
    return { score: s, events: world.events.length, ms };
  }
  const opts: EngineOptions = { ...ALL_ON, ...(spec.engine ?? {}) };
  const engine = new SessionEngine(cfg, tariff, world.sites, world.accounts, { psp, reviewer: operator, reader }, opts);
  for (const e of world.events) engine.ingest(e);
  engine.finish(world.end + cfg.holdMaxHours * HOUR + cfg.noticeDelayMinutes * MINUTE + HOUR);
  const ms = performance.now() - t0;
  const s = score(world, engine.outcomes, psp, {
    operatorMinutes: engine.stats.operatorMinutes,
    reviews: engine.stats.reviews,
    modelCalls: reader.calls,
    agentAccepted: engine.stats.agentAccepted,
    alarms: engine.alarms,
  });
  return { score: s, events: world.events.length, ms };
}
