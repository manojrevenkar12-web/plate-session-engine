import { applyMigration, PrismaStore } from "@pse/store";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { EngineService } from "./engine/engine.service.js";
import { SandboxPsp } from "./payments/psp.js";
import { EDGE, OP, testApp } from "./test-app.js";

const DB = process.env.PSE_TEST_DATABASE_URL;
const REDIS = process.env.PSE_TEST_REDIS_URL;
const T0 = Date.parse("2026-03-02T08:00:00Z");
const MIN = 60_000;

async function until(what: string, f: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe.runIf(DB && REDIS)("Postgres, Prisma and BullMQ", () => {
  it("queues, decides, charges once and rebuilds after a restart", async () => {
    await applyMigration(DB!);
    await new Redis(REDIS!).flushall();
    const env = { DATABASE_URL: DB!, REDIS_URL: REDIS!, PSE_SHARDS: "2" };
    const psp = new SandboxPsp();
    const { app } = await testApp(env, { psp });
    const engine = app.get(EngineService);
    const beats = (from: number, to: number) => {
      const out: object[] = [];
      for (let t = from; t <= to; t += 5 * MIN) for (const s of ["L1-in", "L1-out", "L2-in", "L2-out"]) out.push({ kind: "heartbeat", id: `hb-${s}-${t}`, scanner: `muc-riem-p1-${s}`, site: "muc-riem-p1", at: t });
      return out;
    };
    const send = (events: object[]) => app.inject({ method: "POST", url: "/v1/edge/events", headers: EDGE, payload: { events } });
    const realNow = Date.now;
    try {
      Date.now = () => T0 + 1000;
      expect((await send([...beats(T0 - 10 * MIN, T0), { kind: "read", id: "i-1", scanner: "muc-riem-p1-L1-in", site: "muc-riem-p1", direction: "in", at: T0, plate: "MAB1234", confidence: 0.96, colour: "blue", make: "VW" }])).statusCode).toBe(202);
      Date.now = () => T0 + 95 * MIN;
      const out = [...beats(T0 + 5 * MIN, T0 + 95 * MIN), { kind: "read", id: "o-1", scanner: "muc-riem-p1-L1-out", site: "muc-riem-p1", direction: "out", at: T0 + 90 * MIN, plate: "MAB1234", confidence: 0.97, colour: "blue", make: "VW" }];
      expect((await send(out)).json()).toMatchObject({ duplicates: 0 });
      expect((await send(out)).json()).toMatchObject({ accepted: 0 });
    } finally {
      Date.now = realNow;
    }
    await until("the queue workers", async () => engine.stats().events >= 88);
    await engine.tick(T0 + 4 * 60 * MIN);
    await until("the charge worker", async () => psp.taken.size === 1);
    const sessions = await app.inject({ method: "GET", url: "/v1/sessions?site=muc-riem-p1", headers: OP });
    expect((sessions.json().sessions as { kind: string; amountCents: number }[]).map((s) => [s.kind, s.amountCents])).toEqual([["charge", 400]]);
    const store = new PrismaStore(DB!);
    await until("the outbox to drain", async () => (await store.pendingCharges(10)).length === 0);
    await store.close();
    await app.close();

    const again = await testApp(env, { psp });
    await again.app.get(EngineService).tick(T0 + 5 * 60 * MIN);
    expect(again.app.get(EngineService).outcomesInMemory().map((o) => o.kind)).toEqual(["charge"]);
    expect(psp.taken.size).toBe(1);
    await again.app.close();
  });
});
