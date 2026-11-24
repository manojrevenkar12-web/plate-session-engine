/**
 * Keyed luck. Every random draw is a pure function of (seed, purpose, key), so two designs that look at the same
 * vehicle see the same vehicle, whatever order they ask in.
 */
function hash(text: string): [number, number] {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

export interface Rng {
  next(): number;
  between(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T extends string>(weights: Record<T, number>): T;
  normal(mean?: number, sd?: number): number;
  logNormal(median: number, sigma: number): number;
}

export function rng(seed: number, purpose: string, key: string | number = ""): Rng {
  let [a, b] = hash(`${seed}|${purpose}|${key}`);
  let c = a ^ 0x9e3779b9;
  let d = b ^ 0x85ebca6b;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  const self: Rng = {
    next,
    between: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from an empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (weights) => {
      const keys = Object.keys(weights).sort() as (keyof typeof weights)[];
      const total = keys.reduce((s, k) => s + weights[k], 0);
      let x = next() * total;
      for (const k of keys) {
        x -= weights[k];
        if (x <= 0) return k;
      }
      return keys[keys.length - 1] as keyof typeof weights;
    },
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    logNormal: (median, sigma) => median * Math.exp(self.normal(0, sigma)),
  };
  return self;
}
