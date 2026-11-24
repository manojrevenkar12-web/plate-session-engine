import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@pse/engine";
import { simulate, worldConfig } from "@pse/world";
import { designs, runDesign } from "./run.js";
import type { Score } from "./score.js";

export interface Aggregate {
  visits: number;
  collectibleCents: number;
  capturedCents: number;
  lostCents: number;
  revenueCaptured: number;
  wrongCharges: number;
  wrongNotices: number;
  noticesToPayers: number;
  wrongPer10k: number;
  doubleCharges: number;
  overchargedCents: number;
  operatorMinutes: number;
  operatorMinutesPer1k: number;
  reviews: number;
  modelCalls: number;
  agentAccepted: number;
  degradedScanners: number;
  degradedFlagged: number;
  flagLeadHours: number | null;
  falseDegradedAlarms: number;
  chargedWithin15: number;
}

export interface Gate {
  name: string;
  metric: keyof Aggregate;
  op: "<=" | ">=";
  limit: number;
  value: number;
  pass: boolean;
}

export interface Report {
  world: "dev" | "heldout";
  seeds: number[];
  configHash: string;
  sites: number;
  scanners: number;
  visits: number;
  events: number;
  designs: Record<string, Aggregate>;
  perSeed: Record<string, Record<string, { revenueCaptured: number; wrongPer10k: number; operatorMinutesPer1k: number }>>;
  gates: Gate[];
}

const CONFIG_FILES = ["engine.json", "tariffs.json", "designs.json", "gates.json"];

/** A hash of every setting the engine and the study read, so the held-out lock names exactly what was frozen. */
export function configHash(): string {
  const h = createHash("sha256");
  for (const f of CONFIG_FILES) h.update(readFileSync(join(ROOT, "config", f)));
  return h.digest("hex").slice(0, 16);
}

export function aggregate(scores: Score[]): Aggregate {
  const sum = (k: keyof Score) => scores.reduce((s, x) => s + (x[k] as number), 0);
  const visits = sum("visits");
  const collectible = sum("collectibleCents");
  const captured = sum("capturedCents");
  const leads = scores.flatMap((s) => s.leadHours).sort((a, b) => a - b);
  const degraded = sum("degradedScanners");
  const right = sum("rightCharges");
  return {
    visits,
    collectibleCents: collectible,
    capturedCents: captured,
    lostCents: collectible - captured,
    revenueCaptured: collectible > 0 ? captured / collectible : 1,
    wrongCharges: sum("wrongCharges"),
    wrongNotices: sum("wrongNotices"),
    noticesToPayers: sum("noticesToPayers"),
    wrongPer10k: ((sum("wrongCharges") + sum("wrongNotices")) / visits) * 10_000,
    doubleCharges: sum("doubleCharges"),
    overchargedCents: sum("overchargedCents"),
    operatorMinutes: sum("operatorMinutes"),
    operatorMinutesPer1k: (sum("operatorMinutes") / visits) * 1000,
    reviews: sum("reviews"),
    modelCalls: sum("modelCalls"),
    agentAccepted: sum("agentAccepted"),
    degradedScanners: degraded,
    degradedFlagged: degraded > 0 ? sum("flagged") / degraded : 1,
    flagLeadHours: leads.length > 0 ? leads[Math.floor(leads.length / 2)]! : null,
    falseDegradedAlarms: sum("falseDegradedAlarms"),
    chargedWithin15: right > 0 ? sum("quickCharges") / right : 0,
  };
}

export function judge(agg: Aggregate, world: "dev" | "heldout"): Gate[] {
  const gates = JSON.parse(readFileSync(join(ROOT, "config", "gates.json"), "utf8")) as Record<string, Omit<Gate, "value" | "pass">[]>;
  return (gates[world] ?? gates.dev!).map((g) => {
    const value = agg[g.metric] as number;
    return { ...g, value, pass: g.op === "<=" ? value <= g.limit : value >= g.limit };
  });
}

export function study(world: "dev" | "heldout", log: (s: string) => void = () => {}): Report {
  const cfg = worldConfig(world);
  const d = designs();
  const names = [...d.main, ...d.ablations];
  const scores: Record<string, Score[]> = Object.fromEntries(names.map((n) => [n, []]));
  const perSeed: Report["perSeed"] = {};
  let sites = 0;
  let scanners = 0;
  let visits = 0;
  let events = 0;
  for (const seed of cfg.seeds) {
    const w = simulate(cfg, seed);
    sites += w.sites.length;
    scanners += w.sites.reduce((s, x) => s + x.scanners.length, 0);
    visits += w.truth.visits.length;
    events += w.events.length;
    perSeed[seed] = {};
    for (const name of names) {
      const r = runDesign(w, d.designs[name]!);
      scores[name]!.push(r.score);
      perSeed[seed]![name] = { revenueCaptured: r.score.revenueCaptured, wrongPer10k: r.score.wrongPer10k, operatorMinutesPer1k: r.score.operatorMinutesPer1k };
      log(`${world} seed ${seed} ${name}: revenue ${(100 * r.score.revenueCaptured).toFixed(1)}%, wrong ${r.score.wrongPer10k.toFixed(1)}/10k`);
    }
  }
  const agg = Object.fromEntries(names.map((n) => [n, aggregate(scores[n]!)]));
  const n = cfg.seeds.length;
  return {
    world,
    seeds: cfg.seeds,
    configHash: configHash(),
    sites: sites / n,
    scanners: scanners / n,
    visits,
    events,
    designs: agg,
    perSeed,
    gates: judge(agg.engine!, world),
  };
}

/** Rounds every float to 10 significant digits, so reports compare byte for byte across machines. */
export function tidy<T>(x: T): T {
  if (typeof x === "number") return (Number.isInteger(x) ? x : Number(x.toPrecision(10))) as T;
  if (Array.isArray(x)) return x.map(tidy) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, tidy(v)])) as T;
  return x;
}

export const REPORTS = join(ROOT, "reports");
export const LOCK = join(REPORTS, "heldout.lock");

export function writeReport(r: Report): void {
  writeFileSync(join(REPORTS, `${r.world}.json`), JSON.stringify(tidy(r), null, 1) + "\n");
}

export function readReport(world: "dev" | "heldout"): Report | null {
  const f = join(REPORTS, `${world}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Report) : null;
}
