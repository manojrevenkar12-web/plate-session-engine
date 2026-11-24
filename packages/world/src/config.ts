import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SiteKind, Tariff } from "@pse/domain";

export interface WorldConfig {
  name: string;
  seeds: number[];
  start: string;
  days: number;
  region: "DE" | "AT";
  sites: { count: number; mix: Record<SiteKind, number>; lanes: number[] };
  visitsPerDay: Record<SiteKind, [number, number]>;
  stayMinutes: Record<SiteKind, { median: number; sigma: number }>;
  arrivals: Record<SiteKind, number[]>;
  tariffs: Record<SiteKind, Tariff>;
  plates: { codes: string[] };
  regularShare: number;
  regularsPerSite: [number, number];
  automaticShare: number;
  payBeforeExitShare: number;
  appShare: number;
  typoRate: number;
  colours: Record<string, number>;
  makes: Record<string, number>;
  scanner: {
    missRate: number;
    misreadRate: number;
    dropCharShare: number;
    secondErrorShare: number;
    duplicateRate: number;
    colourError: number;
    makeError: number;
    confidence: { right: [number, number]; wrong: [number, number] };
    offlinePerScannerPerDay: number;
    offlineHours: [number, number];
    skewShare: number;
    skewMinutes: [number, number];
    degradationPerScannerPerDay: number;
    degradationRampHours: number;
    degradedMisread: number;
    degradedMiss: number;
    heartbeatMinutes: number;
    headwaySeconds: number;
    duplicateSpreadSeconds: number;
  };
  delivery: { latencySeconds: [number, number]; redeliveryRate: number; flushSeconds: [number, number] };
  psp: { timeoutRate: number; committedOnTimeout: number };
  noticePayRate: number;
  fleets: { share: number; size: [number, number]; kinds: SiteKind[] };
  operator: {
    minutes: { plain: number; suggested: number; missedExit: number; payment: number; plate: number };
    error: number;
    automationBias: number;
    findsExit: number;
  };
  reader: { accuracy: number; lookalikeError: number; hallucinate: number };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The world reads only its own files. It never opens the engine's config. */
export function worldConfig(name: "dev" | "heldout"): WorldConfig {
  const file = name === "dev" ? "world.json" : "heldout.json";
  return JSON.parse(readFileSync(join(ROOT, "config", file), "utf8")) as WorldConfig;
}
