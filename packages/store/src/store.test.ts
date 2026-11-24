import type { EdgeEvent } from "@pse/domain";
import type { Outcome } from "@pse/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, MemoryStore, PrismaStore, type Store } from "./index.js";

const URL = process.env.PSE_TEST_DATABASE_URL;

const ev = (id: string, sentAt: number): EdgeEvent => ({ kind: "heartbeat", id, scanner: "s-1", site: "site-1", at: sentAt, sentAt });
const out = (session: string): Outcome => ({
  kind: "charge",
  session,
  site: "site-1",
  plate: "MAB1234",
  entryReads: ["r1"],
  exitReads: ["r2"],
  entryAt: 1,
  exitAt: 2,
  decidedAt: 3,
  account: "acct-1",
  amountCents: 400,
  attempts: 1,
});

function contract(name: string, make: () => Promise<Store>) {
  describe(name, () => {
    let store: Store;
    beforeAll(async () => {
      store = await make();
    });
    afterAll(async () => {
      await store.close();
    });

    it("stores an event once and replays in arrival order", async () => {
      expect(await store.appendEvent(ev("a", 2))).toBe(true);
      expect(await store.appendEvent(ev("b", 1))).toBe(true);
      expect(await store.appendEvent(ev("a", 2))).toBe(false);
      const ids: string[] = [];
      for await (const e of store.events()) ids.push(e.id);
      expect(ids).toEqual(["a", "b"]);
    });

    it("stores a batch in one write and says which events were new", async () => {
      const fresh = await store.appendEvents([ev("c", 3), ev("a", 2), ev("d", 4), ev("c", 3)]);
      expect([...fresh].sort()).toEqual(["c", "d"]);
      const ids: string[] = [];
      for await (const e of store.events()) ids.push(e.id);
      expect(ids).toEqual(["a", "b", "c", "d"]);
    });

    it("keeps a decision and a charge key once", async () => {
      expect(await store.saveOutcome(out("s1"))).toBe(true);
      expect(await store.saveOutcome(out("s1"))).toBe(false);
      expect((await store.outcomes({ plate: "MAB1234" })).length).toBe(1);
      expect(await store.enqueueCharge({ key: "k1", account: "acct-1", amountCents: 400, ref: "s1" })).toBe(true);
      expect(await store.enqueueCharge({ key: "k1", account: "acct-1", amountCents: 400, ref: "s1" })).toBe(false);
      expect((await store.pendingCharges(10)).map((c) => c.key)).toEqual(["k1"]);
      await store.markCharge("k1", "done", 1);
      expect(await store.pendingCharges(10)).toEqual([]);
    });

    it("keeps a person's answer once", async () => {
      const a = { itemId: "ox-1", answer: { kind: "orphan-exit" as const, entry: null }, minutes: 2, at: 5, operator: "op-1" };
      expect(await store.saveAnswer(a)).toBe(true);
      expect(await store.saveAnswer(a)).toBe(false);
      expect(await store.answers()).toEqual([a]);
    });
  });
}

contract("MemoryStore", async () => new MemoryStore());
if (URL) {
  contract("PrismaStore on Postgres", async () => {
    await applyMigration(URL);
    return new PrismaStore(URL);
  });
}
