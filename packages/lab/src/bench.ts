import { cpus } from "node:os";
import { HOUR, MINUTE } from "@pse/domain";
import { ALL_ON, engineConfig, SessionEngine, tariffs } from "@pse/engine";
import { SimulatedCropReader, SimulatedOperator, SimulatedPsp, simulate, worldConfig } from "@pse/world";

/** Measured, not simulated: how many events a second one engine instance decides on this machine. */
export function benchEngine(rounds = 3): { eventsPerSecond: number; events: number; machine: string } {
  const w = simulate(worldConfig("dev"), 1);
  const cfg = engineConfig();
  let best = Infinity;
  for (let i = 0; i < rounds; i++) {
    const eng = new SessionEngine(cfg, tariffs(), w.sites, w.accounts, { psp: new SimulatedPsp(w), reviewer: new SimulatedOperator(w), reader: new SimulatedCropReader(w) }, ALL_ON);
    const t0 = performance.now();
    for (const e of w.events) eng.ingest(e);
    eng.finish(w.end + cfg.holdMaxHours * HOUR + cfg.noticeDelayMinutes * MINUTE);
    best = Math.min(best, performance.now() - t0);
  }
  return { eventsPerSecond: Math.round(w.events.length / (best / 1000)), events: w.events.length, machine: `${cpus()[0]?.model.trim() ?? "unknown CPU"}, Node ${process.version}` };
}
