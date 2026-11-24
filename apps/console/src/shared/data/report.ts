import { onMounted, ref, type Ref } from "vue";

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
  op: "<=" | ">=";
  limit: number;
  value: number;
  pass: boolean;
}

export interface Samples {
  lookalike: { site: string; entry: string[]; exit: string[]; billed: string; amountCents: number }[];
  typedPayment: { site: string; plate: string; typed: string }[];
  plateCheck: { site: string; read: string[]; billed: string; amountCents: number }[];
}

export interface WorldReport {
  world: "dev" | "heldout";
  seeds: number[];
  configHash: string;
  sites: number;
  scanners: number;
  visits: number;
  events: number;
  designs: Record<string, Aggregate>;
  gates: Gate[];
  samples?: Samples;
}

export interface Bench {
  engine?: { eventsPerSecond: number; machine: string };
  api?: { readsPerSecond: number; p99ms: number; store: string; queue: string };
}

export interface ConsoleData {
  dev: WorldReport | null;
  heldout: WorldReport | null;
  lock: { seeds: number[]; configHash: string } | null;
  bench: Bench | null;
  order: { main: string[]; ablations: string[] };
  labels: Record<string, string>;
}

export type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: ConsoleData };

/** Loads the generated report. `retry` loads it again after an error. */
export function useReport(url = "./data/report.json"): { load: Ref<Load>; retry: () => Promise<void> } {
  const load = ref<Load>({ state: "loading" });
  const fetchIt = async () => {
    load.value = { state: "loading" };
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The report did not load (HTTP ${res.status}).`);
      load.value = { state: "ready", data: (await res.json()) as ConsoleData };
    } catch (e) {
      load.value = { state: "error", message: e instanceof Error ? e.message : String(e) };
    }
  };
  onMounted(fetchIt);
  return { load, retry: fetchIt };
}

/** Short names where the full design label does not fit. */
export const SHORT: Record<string, string> = {
  status_quo: "Exact match",
  fuzzy_match: "Fuzzy match",
  model_alone: "Model alone",
  engine: "This engine",
  no_watermark: "No watermark",
  no_skew: "No clock correction",
  no_evidence: "Plate only",
  no_review: "No review",
  no_agent: "No crop check",
  no_idempotency: "No idempotency key",
  no_quality: "No missed-exit or typo handling",
};
