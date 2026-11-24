import {
  type Account,
  type ChargeRequest,
  type CropReader,
  type EdgeEvent,
  HOUR,
  MINUTE,
  type PaymentProvider,
  type ReviewAnswer,
  type ReviewItem,
  type Reviewer,
  type SiteInfo,
} from "@pse/domain";
import { describe, expect, it } from "vitest";
import { ALL_ON, type EngineOptions, engineConfig, SessionEngine, tariffs } from "./index.js";

const T0 = Date.parse("2026-03-02T08:00:00Z");
const SITE: SiteInfo = {
  id: "site-1",
  kind: "shopping",
  tariff: "shopping",
  scanners: [
    { id: "in-1", direction: "in", lane: 1 },
    { id: "out-1", direction: "out", lane: 1 },
  ],
};

class Psp implements PaymentProvider {
  calls: ChargeRequest[] = [];
  ledger: ChargeRequest[] = [];
  keys = new Set<string>();
  constructor(private readonly timeouts = 0) {}
  charge(req: ChargeRequest) {
    this.calls.push(req);
    if (req.idempotencyKey && this.keys.has(req.idempotencyKey)) return "ok" as const;
    this.ledger.push(req);
    if (req.idempotencyKey) this.keys.add(req.idempotencyKey);
    return this.calls.length <= this.timeouts ? ("timeout" as const) : ("ok" as const);
  }
}

class Queue implements Reviewer {
  items: ReviewItem[] = [];
  constructor(private readonly auto?: (i: ReviewItem) => ReviewAnswer) {}
  resolve(item: ReviewItem) {
    this.items.push(item);
    return this.auto ? { answer: this.auto(item), minutes: 1 } : null;
  }
}

let n = 0;
const read = (scanner: string, direction: "in" | "out", plate: string, at: number, extra: Partial<EdgeEvent> = {}): EdgeEvent =>
  ({ kind: "read", id: `r${++n}`, scanner, site: SITE.id, direction, at, plate, confidence: 0.95, colour: "blue", make: "VW", sentAt: at + 1000, ...extra }) as EdgeEvent;
const beat = (scanner: string, at: number, sentAt = at + 500): EdgeEvent => ({ kind: "heartbeat", id: `hb-${scanner}-${at}-${++n}`, scanner, site: SITE.id, at, sentAt });

function engine(opts: Partial<EngineOptions> = {}, ports: { psp?: Psp; reviewer?: Reviewer; reader?: CropReader | null; accounts?: Account[] } = {}) {
  const psp = ports.psp ?? new Psp();
  const reviewer = ports.reviewer ?? new Queue();
  const e = new SessionEngine(engineConfig(), tariffs(), [SITE], ports.accounts ?? [{ id: "acct-1", plate: "MAB1234" }], { psp, reviewer, reader: ports.reader ?? null }, { ...ALL_ON, ...opts });
  return { e, psp, reviewer };
}

/** feeds events and a heartbeat stream for both scanners, in arrival order */
function play(e: SessionEngine, events: EdgeEvent[], until: number) {
  const all = [...events];
  for (let t = T0 - 10 * MINUTE; t <= until; t += 5 * MINUTE) all.push(beat("in-1", t), beat("out-1", t));
  all.sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : 1));
  for (const x of all) e.ingest(x);
  e.tick(until + 3 * HOUR);
}

describe("SessionEngine", () => {
  it("charges a registered driver once for an exact match", () => {
    const { e, psp } = engine();
    play(e, [read("in-1", "in", "MAB1234", T0), read("out-1", "out", "MAB1234", T0 + 2 * HOUR + 5 * MINUTE)], T0 + 3 * HOUR);
    const charges = e.outcomes.filter((o) => o.kind === "charge");
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ account: "acct-1", amountCents: 600 });
    expect(psp.ledger).toHaveLength(1);
  });

  it("ignores an event delivered twice", () => {
    const { e } = engine();
    const x = read("in-1", "in", "MAB1234", T0);
    e.ingest(x);
    e.ingest(x);
    expect(e.stats.duplicates).toBe(1);
  });

  it("matches an exit read with a lookalike character", () => {
    const { e } = engine();
    play(e, [read("in-1", "in", "MAB1234", T0), read("out-1", "out", "MA81234", T0 + 2 * HOUR)], T0 + 3 * HOUR);
    expect(e.outcomes.find((o) => o.kind === "charge")).toMatchObject({ account: "acct-1", plate: "MAB1234" });
  });

  it("never charges twice when the provider times out after taking the money", () => {
    const psp = new Psp(2);
    const { e } = engine({}, { psp });
    play(e, [read("in-1", "in", "MAB1234", T0), read("out-1", "out", "MAB1234", T0 + 2 * HOUR)], T0 + 3 * HOUR);
    // the second attempt carries the same key: the provider answers "ok" for the charge it already took
    expect(psp.calls.length).toBe(2);
    expect(new Set(psp.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(psp.ledger).toHaveLength(1);
  });

  it("holds an exit while the entry scanner is offline, then matches its backlog", () => {
    const { e } = engine();
    const entry = read("in-1", "in", "MAB1234", T0, { sentAt: T0 + 3 * HOUR } as Partial<EdgeEvent>);
    const exit = read("out-1", "out", "MAB1234", T0 + 2 * HOUR);
    const events: EdgeEvent[] = [entry, exit];
    for (let t = T0 - 10 * MINUTE; t <= T0 + 5 * HOUR; t += 5 * MINUTE) {
      events.push(beat("out-1", t));
      if (t < T0 - MINUTE || t >= T0 + 3 * HOUR) events.push(beat("in-1", t));
    }
    events.sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : 1));
    for (const x of events) e.ingest(x);
    e.tick(T0 + 6 * HOUR);
    expect(e.outcomes.find((o) => o.kind === "charge")).toMatchObject({ account: "acct-1" });
    expect(e.stats.held).toBe(1);
  });

  it("without the watermark writes that exit off", () => {
    const { e } = engine({ watermark: false, agent: false }, { reviewer: new Queue(() => ({ kind: "orphan-exit", entry: null })) });
    const entry = read("in-1", "in", "MAB1234", T0, { sentAt: T0 + 3 * HOUR } as Partial<EdgeEvent>);
    play(e, [entry, read("out-1", "out", "MAB1234", T0 + 2 * HOUR)], T0 + 4 * HOUR);
    expect(e.outcomes.some((o) => o.kind === "write-off" && o.reason === "missed-entry")).toBe(true);
  });

  it("links a payment typed with a typo when its amount fits the stay", () => {
    const { e } = engine({}, { accounts: [] });
    const pay: EdgeEvent = { kind: "payment", id: "pay-1", site: SITE.id, plate: "MAB1243", at: T0 + 110 * MINUTE, amountCents: 400, channel: "terminal", sentAt: T0 + 110 * MINUTE + 800 };
    play(e, [read("in-1", "in", "MAB1234", T0), pay, read("out-1", "out", "MAB1234", T0 + 2 * HOUR)], T0 + 5 * HOUR);
    expect(e.outcomes.find((o) => o.kind === "paid")).toMatchObject({ payment: "pay-1" });
    expect(e.outcomes.some((o) => o.kind === "notice")).toBe(false);
  });

  it("sends a notice only for a certain plate, and asks a person otherwise", () => {
    const q = new Queue();
    const { e } = engine({}, { accounts: [], reviewer: q });
    play(e, [read("in-1", "in", "MXY1234", T0), read("out-1", "out", "MXY1284", T0 + 2 * HOUR, { confidence: 0.94 } as Partial<EdgeEvent>)], T0 + 5 * HOUR);
    expect(e.outcomes.some((o) => o.kind === "notice")).toBe(false);
    const plate = e.pendingReviews().find((p) => p.item.kind === "plate");
    expect(plate).toBeDefined();
    expect(e.answer(plate!.item.id, { kind: "plate", plate: "MXY1234" }, 2)).toBe(true);
    expect(e.outcomes.find((o) => o.kind === "notice")).toMatchObject({ plate: "MXY1234", amountCents: 400 });
    expect(e.answer(plate!.item.id, { kind: "plate", plate: "MXY1234" })).toBe(false);
  });

  it("asks the crop reader, and verifies its pick before taking it", () => {
    const reader: CropReader = { compare: (q) => ({ candidate: q.candidates[0]?.id ?? null, confidence: 0.97 }) };
    const { e } = engine({}, { reader });
    play(e, [read("in-1", "in", "MAB1234", T0, { colour: "red", make: "BMW" } as Partial<EdgeEvent>), read("out-1", "out", "MAB12E4", T0 + 2 * HOUR)], T0 + 3 * HOUR);
    expect(e.stats.agentAsked).toBe(1);
    expect(e.stats.agentAccepted).toBe(1);
    expect(e.outcomes.find((o) => o.kind === "charge")).toBeDefined();
  });

  it("takes a crop answer that arrives later, through the same check", () => {
    const { e } = engine({}, { reader: null });
    play(e, [read("in-1", "in", "MAB1234", T0, { colour: "red", make: "BMW" } as Partial<EdgeEvent>), read("out-1", "out", "MAB12E4", T0 + 2 * HOUR)], T0 + 3 * HOUR);
    const item = e.pendingReviews().find((p) => p.item.kind === "orphan-exit")!.item;
    expect(e.offerCropAnswer(item.id, { candidate: "nope", confidence: 0.99 }).result).toBe("suggested");
    const first = (item as { candidates: { id: string }[] }).candidates[0]!.id;
    expect(e.offerCropAnswer(item.id, { candidate: first, confidence: 0.96 })).toEqual({ result: "accepted", resolved: { kind: "orphan-exit", entry: first } });
    expect(e.outcomes.find((o) => o.kind === "charge")).toBeDefined();
    expect(e.offerCropAnswer(item.id, { candidate: null, confidence: 1 }).result).toBe("unknown");
  });

  it("closes a missed exit when the same plate enters again", () => {
    const { e, reviewer } = engine({}, { reviewer: new Queue((i) => ({ kind: "missed-exit", exitAt: i.kind === "missed-exit" ? T0 + 9 * HOUR : null })) });
    play(e, [read("in-1", "in", "MAB1234", T0), read("in-1", "in", "MAB1234", T0 + 26 * HOUR)], T0 + 27 * HOUR);
    expect((reviewer as Queue).items.some((i) => i.kind === "missed-exit")).toBe(true);
    expect(e.outcomes.find((o) => o.kind === "charge")).toMatchObject({ amountCents: 1500 });
  });

  it("corrects a scanner whose clock runs ten minutes fast", () => {
    const { e } = engine();
    const events: EdgeEvent[] = [];
    for (let t = T0 - 60 * MINUTE; t <= T0 + 3 * HOUR; t += 5 * MINUTE) events.push(beat("in-1", t + 10 * MINUTE, t + 500), beat("out-1", t));
    events.push(read("in-1", "in", "MAB1234", T0 + 10 * MINUTE, { sentAt: T0 + 1000 } as Partial<EdgeEvent>));
    events.push(read("out-1", "out", "MAB1234", T0 + 62 * MINUTE));
    events.sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : 1));
    for (const x of events) e.ingest(x);
    e.tick(T0 + 5 * HOUR);
    // 62 minutes is past the free hour: two started hours. Uncorrected the stay looks like 52 minutes, free.
    expect(e.outcomes.find((o) => o.kind === "charge")).toMatchObject({ amountCents: 400 });
  });

  it("flags a scanner whose reads lose confidence", () => {
    const { e } = engine();
    const events: EdgeEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(read("in-1", "in", `MQ${100 + i}`, T0 + i * MINUTE, { confidence: 0.7 } as Partial<EdgeEvent>));
    for (const x of events) e.ingest(x);
    expect(e.alarms.some((a) => a.kind === "degraded" && a.scanner === "in-1")).toBe(true);
    expect(e.scannerStatus().find((s) => s.id === "in-1")?.degraded).toBe(true);
  });
});
