import type { EdgeEvent, ReviewAnswer } from "@pse/domain";
import type { Outcome } from "@pse/engine";

export interface ChargeRow {
  key: string;
  account: string;
  amountCents: number;
  ref: string;
  status: "pending" | "done" | "failed";
  attempts: number;
}

export interface StoredAnswer {
  itemId: string;
  answer: ReviewAnswer;
  minutes: number;
  at: number;
  operator: string;
}

/**
 * The engine's durable side. Every write is idempotent: an event, a decision, a charge key or an answer seen
 * before is refused, so retries from edge devices, queues and workers cannot double anything.
 */
export interface Store {
  /** true if new; false if this event id was stored before */
  appendEvent(e: EdgeEvent): Promise<boolean>;
  /** every event in arrival order, for rebuilding the engine after a restart */
  events(): AsyncIterable<EdgeEvent>;
  saveOutcome(o: Outcome): Promise<boolean>;
  outcomes(filter: { site?: string; plate?: string; limit?: number }): Promise<Outcome[]>;
  /** the outbox: true if this charge key is new */
  enqueueCharge(c: Omit<ChargeRow, "status" | "attempts">): Promise<boolean>;
  pendingCharges(limit: number): Promise<ChargeRow[]>;
  markCharge(key: string, status: ChargeRow["status"], attempts: number): Promise<void>;
  saveAnswer(a: StoredAnswer): Promise<boolean>;
  answers(): Promise<StoredAnswer[]>;
  close(): Promise<void>;
}

export class MemoryStore implements Store {
  private readonly log: EdgeEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly decided = new Map<string, Outcome>();
  private readonly charges = new Map<string, ChargeRow>();
  private readonly given = new Map<string, StoredAnswer>();

  async appendEvent(e: EdgeEvent): Promise<boolean> {
    if (this.ids.has(e.id)) return false;
    this.ids.add(e.id);
    this.log.push(e);
    return true;
  }

  async *events(): AsyncIterable<EdgeEvent> {
    for (const e of this.log) yield e;
  }

  async saveOutcome(o: Outcome): Promise<boolean> {
    const k = `${o.session}|${o.kind}`;
    if (this.decided.has(k)) return false;
    this.decided.set(k, o);
    return true;
  }

  async outcomes(f: { site?: string; plate?: string; limit?: number }): Promise<Outcome[]> {
    return [...this.decided.values()]
      .filter((o) => (!f.site || o.site === f.site) && (!f.plate || o.plate === f.plate))
      .sort((a, b) => b.decidedAt - a.decidedAt)
      .slice(0, f.limit ?? 100);
  }

  async enqueueCharge(c: Omit<ChargeRow, "status" | "attempts">): Promise<boolean> {
    if (this.charges.has(c.key)) return false;
    this.charges.set(c.key, { ...c, status: "pending", attempts: 0 });
    return true;
  }

  async pendingCharges(limit: number): Promise<ChargeRow[]> {
    return [...this.charges.values()].filter((c) => c.status === "pending").slice(0, limit);
  }

  async markCharge(key: string, status: ChargeRow["status"], attempts: number): Promise<void> {
    const c = this.charges.get(key);
    if (c) this.charges.set(key, { ...c, status, attempts });
  }

  async saveAnswer(a: StoredAnswer): Promise<boolean> {
    if (this.given.has(a.itemId)) return false;
    this.given.set(a.itemId, a);
    return true;
  }

  async answers(): Promise<StoredAnswer[]> {
    return [...this.given.values()].sort((a, b) => a.at - b.at);
  }

  async close(): Promise<void> {}
}
