/**
 * Finds plates a reader could have confused, without comparing against every car on site.
 *
 * Each plate is stored under its skeleton: confusable characters folded into one class (O, 0, D and Q all become
 * "0"), so a pure lookalike misread lands on the same key. Every one-character deletion of the skeleton is stored
 * as well, which also catches a lost or invented character and one ordinary substitution (symmetric deletion).
 * The index returns candidates; the caller still measures the real distance.
 */
const FOLD: Record<string, string> = {
  O: "0", D: "0", Q: "0", Ö: "0",
  I: "1", L: "1",
  B: "8",
  S: "5",
  Z: "2",
  G: "6", C: "6",
  A: "4", Ä: "4",
  T: "7",
  M: "N", H: "N",
  V: "U", Ü: "U",
  F: "E",
  X: "K",
};

export function skeleton(plate: string): string {
  let out = "";
  for (const c of plate) out += FOLD[c] ?? c;
  return out;
}

function keys(plate: string, fold: boolean): string[] {
  const s = fold ? skeleton(plate) : plate;
  const out = new Set<string>([s]);
  for (let i = 0; i < s.length; i++) out.add(s.slice(0, i) + s.slice(i + 1));
  return [...out];
}

export class PlateIndex<T> {
  private readonly map = new Map<string, Set<T>>();
  private readonly entries = new Map<T, string[]>();

  /** `fold` false gives a plain one-edit index (what a generic fuzzy match uses). */
  constructor(private readonly fold = true) {}

  add(item: T, plates: string[]): void {
    this.remove(item);
    const all = new Set<string>();
    for (const p of plates) for (const k of keys(p, this.fold)) all.add(k);
    const list = [...all];
    this.entries.set(item, list);
    for (const k of list) {
      let set = this.map.get(k);
      if (!set) this.map.set(k, (set = new Set()));
      set.add(item);
    }
  }

  remove(item: T): void {
    const list = this.entries.get(item);
    if (!list) return;
    for (const k of list) {
      const set = this.map.get(k);
      set?.delete(item);
      if (set && set.size === 0) this.map.delete(k);
    }
    this.entries.delete(item);
  }

  has(item: T): boolean {
    return this.entries.has(item);
  }

  get size(): number {
    return this.entries.size;
  }

  query(plates: string[]): T[] {
    const out = new Set<T>();
    for (const p of plates) for (const k of keys(p, this.fold)) for (const item of this.map.get(k) ?? []) out.add(item);
    return [...out];
  }
}
