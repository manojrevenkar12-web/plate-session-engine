/** What the engine decided about one stay. Every design in the lab produces these, so all are scored alike. */
export interface SessionRef {
  session: string;
  site: string;
  plate: string;
  entryReads: string[];
  exitReads: string[];
  entryAt: number | null;
  exitAt: number | null;
  /** cloud time the decision was taken */
  decidedAt: number;
}

export type Outcome =
  | (SessionRef & { kind: "charge"; account: string; amountCents: number; attempts: number })
  | (SessionRef & { kind: "notice"; amountCents: number })
  | (SessionRef & { kind: "paid"; payment: string })
  | (SessionRef & { kind: "free" })
  | (SessionRef & { kind: "write-off"; reason: "missed-entry" | "missed-exit" | "low-confidence" | "charge-failed" });

export interface Alarm {
  scanner: string;
  site: string;
  kind: "degraded" | "offline";
  at: number;
}

export interface EngineStats {
  events: number;
  duplicates: number;
  passes: number;
  exits: number;
  exact: number;
  auto: number;
  agentAsked: number;
  agentAccepted: number;
  reviews: number;
  operatorMinutes: number;
  held: number;
  skewCorrected: number;
  missedExits: number;
}
