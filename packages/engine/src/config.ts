import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SiteKind, Tariff } from "@pse/domain";

export interface EngineConfig {
  dedupeWindowSeconds: number;
  /** two cars cannot pass one scanner this close together: reads closer than this are one car */
  samePassSeconds: number;
  /** ...unless their plates are further apart than this, which only another car explains */
  samePassMaxDistance: number;
  /** an entry still open after median × e^(this × sigma) of its site's stays is checked for a missed exit */
  staleAfterSigma: number;
  settleSeconds: number;
  heartbeatMinutes: number;
  reconnectSettleMinutes: number;
  holdMaxHours: number;
  noticeDelayMinutes: number;
  skew: { samples: number; minSeconds: number };
  stayPriors: Record<SiteKind, { median: number; sigma: number }>;
  match: {
    maxDistance: number;
    /** how much less likely an exact plate is to belong to another car than to this one, as log odds */
    coincidenceLogOdds: number;
    plateWeight: number;
    /** chance the scanners agree on colour when it is the same car, and when it is another car */
    colour: { sameCar: number; otherCar: number };
    make: { sameCar: number; otherCar: number };
    stayToleranceSigma: number;
    missedEntryLogWeight: number;
    autoPosterior: number;
    autoMissedEntry: number;
  };
  agent: { acceptConfidence: number; minPosterior: number; missedEntryPosterior: number };
  payments: { maxDistance: number; graceMinutes: number };
  notice: { minFeeCents: number; minPosterior: number; lookalikeDistance: number };
  billing: { maxAttempts: number };
  /** plate grammars of the regions served; a spelling that fits none is a misread */
  plateFormats: string[];
  /** a review must be worth more than the operator time it takes */
  reviewEconomics: {
    operatorCentsPerMinute: number;
    minutes: Record<"orphan-exit" | "missed-exit" | "plate" | "payment", number>;
    findRate: number;
    noticePayRate: number;
  };
  health: { window: number; lowConfidence: number; baseline: number; slack: number; threshold: number; offlineMinutes: number };
}

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function engineConfig(): EngineConfig {
  return JSON.parse(readFileSync(join(ROOT, "config", "engine.json"), "utf8")) as EngineConfig;
}

export function tariffs(): Record<string, Tariff> {
  return JSON.parse(readFileSync(join(ROOT, "config", "tariffs.json"), "utf8")) as Record<string, Tariff>;
}
