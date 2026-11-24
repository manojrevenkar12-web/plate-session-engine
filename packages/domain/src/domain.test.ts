import { describe, expect, it } from "vitest";
import { feeCents, HOUR, levenshtein, MINUTE, normalize, plateDistance, rng } from "./index.js";

describe("luck", () => {
  it("depends only on seed, purpose and key", () => {
    const a = rng(1, "visit", "s1:7");
    const b = rng(1, "visit", "s1:7");
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    expect(rng(1, "visit", "s1:8").next()).not.toEqual(rng(1, "visit", "s1:7").next());
  });
  it("is roughly uniform", () => {
    const r = rng(9, "u");
    let s = 0;
    for (let i = 0; i < 20000; i++) s += r.next();
    expect(s / 20000).toBeGreaterThan(0.49);
    expect(s / 20000).toBeLessThan(0.51);
  });
});

describe("plates", () => {
  it("normalises German formats", () => {
    expect(normalize("M-AB 1234")).toBe("MAB1234");
    expect(normalize(" dah-x 9e")).toBe("DAHX9E");
  });
  it("makes reader confusions cheaper than other substitutions", () => {
    expect(plateDistance("MAB1234", "MA81234")).toBeLessThan(plateDistance("MAB1234", "MAC1234"));
    expect(plateDistance("MAB1234", "MAB1234")).toBe(0);
    expect(plateDistance("MAB1234", "MAB124")).toBeCloseTo(0.7);
    expect(levenshtein("MAB1234", "MA81234")).toBe(1);
  });
});

describe("tariff", () => {
  const t = { freeMinutes: 30, centsPerHour: 250, dailyCapCents: 1800 };
  it("charges every started hour after the free minutes, capped per day", () => {
    expect(feeCents(t, 29 * MINUTE)).toBe(0);
    expect(feeCents(t, 31 * MINUTE)).toBe(250);
    expect(feeCents(t, 2 * HOUR + 1)).toBe(750);
    expect(feeCents(t, 23 * HOUR)).toBe(1800);
    expect(feeCents(t, 26 * HOUR)).toBe(1800 + 500);
  });
});
