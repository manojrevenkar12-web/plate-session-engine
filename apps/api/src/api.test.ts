import { MemoryStore } from "@pse/store";
import { afterEach, describe, expect, it } from "vitest";
import { parseCropAnswer, ClaudeCropReader } from "./agent/claude-crop-reader.js";
import { EngineService } from "./engine/engine.service.js";
import { ChargeWorker } from "./payments/charge.worker.js";
import { SandboxPsp } from "./payments/psp.js";
import { EDGE, OP, testApp } from "./test-app.js";

const T0 = Date.parse("2026-03-02T08:00:00Z");
const MIN = 60_000;
let n = 0;
const read = (scanner: string, direction: "in" | "out", plate: string, at: number, extra: Record<string, unknown> = {}) => ({
  kind: "read",
  id: `r-${++n}`,
  scanner,
  site: "muc-riem-p1",
  direction,
  at,
  plate,
  confidence: 0.95,
  colour: "blue",
  make: "VW",
  ...extra,
});
const beats = (from: number, to: number) => {
  const out: object[] = [];
  for (let t = from; t <= to; t += 5 * MIN) for (const s of ["L1-in", "L1-out", "L2-in", "L2-out"]) out.push({ kind: "heartbeat", id: `hb-${s}-${t}`, scanner: `muc-riem-p1-${s}`, site: "muc-riem-p1", at: t });
  return out;
};

const apps: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

/** Plays a scene: each batch arrives at the server at the time given (the clock the engine runs on). */
async function scene(app: Awaited<ReturnType<typeof testApp>>["app"], batches: { at: number; events: object[] }[]) {
  const engine = app.get(EngineService);
  const realNow = Date.now;
  try {
    for (const b of batches) {
      Date.now = () => b.at;
      const res = await app.inject({ method: "POST", url: "/v1/edge/events", headers: EDGE, payload: { events: b.events } });
      expect(res.statusCode, res.body).toBe(202);
    }
    const last = batches[batches.length - 1]!.at;
    for (const later of [MIN, 30 * MIN, 4 * 60 * MIN]) {
      Date.now = () => last + later;
      await engine.tick(Date.now());
    }
  } finally {
    Date.now = realNow;
  }
}

describe("the API", () => {
  it("takes edge events once, decides the stay and charges through the outbox", async () => {
    const psp = new SandboxPsp();
    const store = new MemoryStore();
    const { app } = await testApp({}, { psp, store });
    apps.push(app);
    const entry = read("muc-riem-p1-L1-in", "in", "M-AB 1234", T0);
    await scene(app, [
      { at: T0 + 1000, events: [...beats(T0 - 10 * MIN, T0), entry] },
      { at: T0 + 2000, events: [entry] },
      { at: T0 + 125 * MIN, events: [...beats(T0 + 5 * MIN, T0 + 125 * MIN), read("muc-riem-p1-L2-out", "out", "MAB1234", T0 + 2 * 60 * MIN + 5 * MIN)] },
    ]);
    const res = await app.inject({ method: "GET", url: "/v1/sessions?plate=m-ab 1234", headers: OP });
    const sessions = res.json().sessions as { kind: string; amountCents?: number }[];
    expect(sessions.map((s) => s.kind)).toEqual(["charge"]);
    expect(sessions[0]!.amountCents).toBe(600);
    await app.get(ChargeWorker).drain();
    expect([...psp.taken.values()]).toEqual([{ account: "acct-1001", amountCents: 600 }]);
    const m = await app.inject({ method: "GET", url: "/metrics" });
    expect(m.body).toContain("pse_events_duplicate_total 1");
  });

  it("rebuilds the same decisions after a restart, from the log", async () => {
    const store = new MemoryStore();
    const psp = new SandboxPsp();
    const first = await testApp({}, { store, psp });
    await scene(first.app, [
      { at: T0 + 1000, events: [...beats(T0 - 10 * MIN, T0), read("muc-riem-p1-L1-in", "in", "MAB1234", T0)] },
      { at: T0 + 125 * MIN, events: [...beats(T0 + 5 * MIN, T0 + 125 * MIN), read("muc-riem-p1-L1-out", "out", "MAB1234", T0 + 120 * MIN)] },
    ]);
    const before = first.app.get(EngineService).outcomesInMemory().map((o) => `${o.session}:${o.kind}`);
    await first.app.close();
    expect(before).toEqual([expect.stringMatching(/:charge$/)]);
    const second = await testApp({}, { store, psp });
    apps.push(second.app);
    await second.app.get(EngineService).tick(T0 + 10 * 60 * MIN);
    await second.app.get(ChargeWorker).drain();
    expect(second.app.get(EngineService).outcomesInMemory().map((o) => `${o.session}:${o.kind}`)).toEqual(before);
    // the rebuilt engine asked for the same charge again; the outbox key and the provider's key refused it
    expect(psp.taken.size).toBe(1);
  });

  it("queues an unclear plate for a person and sends the notice after the answer", async () => {
    const { app } = await testApp({}, { psp: new SandboxPsp() });
    apps.push(app);
    await scene(app, [
      { at: T0 + 1000, events: [...beats(T0 - 10 * MIN, T0), read("muc-riem-p1-L1-in", "in", "MXY1234", T0)] },
      { at: T0 + 125 * MIN, events: [...beats(T0 + 5 * MIN, T0 + 125 * MIN), read("muc-riem-p1-L1-out", "out", "MXY1284", T0 + 120 * MIN, { confidence: 0.94 })] },
    ]);
    const list = await app.inject({ method: "GET", url: "/v1/reviews", headers: OP });
    const review = (list.json().reviews as { item: { id: string; kind: string } }[]).find((r) => r.item.kind === "plate")!;
    expect(review).toBeDefined();
    const body = { answer: { kind: "plate", plate: "M-XY 1234" }, minutes: 1.5, operator: "op-7" };
    const ok = await app.inject({ method: "POST", url: `/v1/reviews/${review.item.id}/answer`, headers: OP, payload: body });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/v1/reviews/${review.item.id}/answer`, headers: OP, payload: body });
    expect(again.statusCode).toBe(404);
    const s = await app.inject({ method: "GET", url: "/v1/sessions?plate=MXY1234", headers: OP });
    expect((s.json().sessions as { kind: string }[]).map((x) => x.kind)).toEqual(["notice"]);
  });

  it("refuses bad input, unknown scanners and missing tokens", async () => {
    const { app } = await testApp();
    apps.push(app);
    const noToken = await app.inject({ method: "POST", url: "/v1/edge/events", payload: { events: [read("muc-riem-p1-L1-in", "in", "MAB1234", T0)] } });
    expect(noToken.statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/v1/edge/events", headers: EDGE, payload: { events: [{ kind: "read", id: "x" }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("scanner");
    const wrongSite = await app.inject({ method: "POST", url: "/v1/edge/events", headers: EDGE, payload: { events: [read("fra-klinik-p2-L1-in", "in", "MAB1234", T0)] } });
    expect(wrongSite.statusCode).toBe(422);
    const ops = await app.inject({ method: "GET", url: "/v1/reviews", headers: EDGE });
    expect(ops.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
  });

  it("lets the crop reader settle an orphan exit, through the engine's check", async () => {
    let asked = 0;
    const reader = {
      compare: async (q: { candidates: { id: string }[] }) => {
        asked++;
        return { candidate: q.candidates[0]!.id, confidence: 0.97 };
      },
    };
    const { app } = await testApp({}, { psp: new SandboxPsp(), reader: reader as never });
    apps.push(app);
    await scene(app, [
      { at: T0 + 1000, events: [...beats(T0 - 10 * MIN, T0), read("muc-riem-p1-L1-in", "in", "MAB1234", T0, { colour: "red", make: "BMW" })] },
      { at: T0 + 125 * MIN, events: [...beats(T0 + 5 * MIN, T0 + 125 * MIN), read("muc-riem-p1-L1-out", "out", "MAB12E4", T0 + 120 * MIN)] },
    ]);
    const { AgentService } = await import("./agent/agent.service.js");
    expect(await app.get(AgentService).sweep()).toBe(1);
    expect(asked).toBe(1);
    const s = await app.inject({ method: "GET", url: "/v1/sessions?plate=MAB1234", headers: OP });
    expect((s.json().sessions as { kind: string }[]).map((x) => x.kind)).toEqual(["charge"]);
  });
});

describe("the Claude crop reader", () => {
  it("sends the crops and parses a candidate it was shown", async () => {
    let sent: { model: string; messages: { content: { type: string }[] }[] } | null = null;
    const fake = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: "text", text: 'Same car: {"candidate": "e1", "confidence": 0.93}' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const reader = new ClaudeCropReader("key", "claude-haiku-4-5", fake);
    const view = (id: string, url?: string) => ({ id, scanner: "s", reads: [{ id, plate: "MAB1234", confidence: 0.9, colour: "blue", make: "VW", at: 0, ...(url ? { cropUrl: url } : {}) }] });
    const answer = await reader.compare({ site: "x", exit: view("x1", "https://cdn.example/x1.jpg"), candidates: [view("e1", "https://cdn.example/e1.jpg"), view("e2")] });
    expect(answer).toEqual({ candidate: "e1", confidence: 0.93 });
    expect(sent!.model).toBe("claude-haiku-4-5");
    expect(sent!.messages[0]!.content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(await reader.compare({ site: "x", exit: view("x1"), candidates: [view("e1")] })).toBeNull();
  });

  it("treats malformed output or an invented candidate as no answer", () => {
    const ids = new Set(["e1"]);
    expect(parseCropAnswer("no json here", ids)).toBeNull();
    expect(parseCropAnswer('{"candidate": "e9", "confidence": 0.99}', ids)).toBeNull();
    expect(parseCropAnswer('{"candidate": null, "confidence": 0.8}', ids)).toEqual({ candidate: null, confidence: 0.8 });
    expect(parseCropAnswer('{"candidate": "e1", "confidence": 3}', ids)).toBeNull();
  });
});
