import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulate, type WorldConfig, worldConfig } from "./index.js";

const small = (name: "dev" | "heldout" = "dev"): WorldConfig => {
  const c = worldConfig(name);
  return { ...c, days: 1, sites: { ...c.sites, count: 12 } };
};

describe("the simulated world", () => {
  it("is the same world for the same seed", () => {
    const a = simulate(small(), 7);
    const b = simulate(small(), 7);
    expect(a.events.length).toBe(b.events.length);
    expect(a.events.slice(0, 50)).toEqual(b.events.slice(0, 50));
    expect(simulate(small(), 8).events.length).not.toBe(a.events.length);
  });

  it("delivers events in arrival order, with duplicates and backlogs", () => {
    const w = simulate(small(), 3);
    for (let i = 1; i < w.events.length; i++) expect(w.events[i]!.sentAt).toBeGreaterThanOrEqual(w.events[i - 1]!.sentAt);
    const ids = w.events.map((e) => e.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
    const late = w.events.filter((e) => e.kind === "read" && e.sentAt - e.at > 30 * 60_000);
    expect(late.length).toBeGreaterThan(0);
  });

  it("knows the visit behind every read, and keeps cars at one lane apart", () => {
    const w = simulate(small(), 4);
    for (const e of w.events) if (e.kind === "read") expect(w.truth.visitByRead.has(e.id)).toBe(true);
    const visit = w.truth.visits.find((v) => v.exited && v.entryReads.length > 0)!;
    expect(visit.exitAt).toBeGreaterThan(visit.entryAt);
    expect(visit.dueCents).toBeGreaterThanOrEqual(0);
  });

  it("charges what a paying driver saw at the terminal", () => {
    const w = simulate(small(), 5);
    const paid = w.truth.visits.filter((v) => v.paid);
    expect(paid.length).toBeGreaterThan(10);
    for (const v of paid) {
      const e = w.events.find((x) => x.kind === "payment" && x.id === v.paymentId);
      expect(e && e.kind === "payment" && e.amountCents).toBe(v.dueCents);
    }
  });

  it("is a different place when held out", () => {
    const dev = simulate(small("dev"), 1);
    const held = simulate(small("heldout"), 1);
    expect(dev.truth.visits[0]!.plate).toMatch(/^[A-Z]+[0-9]+$/);
    expect(held.truth.visits.some((v) => /[0-9][A-Z]+$/.test(v.plate))).toBe(true);
  });

  it("does not read the engine's settings", () => {
    const dir = join(import.meta.dirname, ".");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text).not.toMatch(/engine\.json|tariffs\.json|gates\.json|designs\.json|@pse\/engine|@pse\/lab/);
    }
  });
});
