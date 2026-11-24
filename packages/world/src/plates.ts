import { type Rng, CONFUSABLE, normalize } from "@pse/domain";

const LETTERS = "ABCDEFGHIJKLMNOPRSTUVWXYZ";

/** A plate in the region's format, normalised. DE: "M-AB 1234" → "MAB1234"; AT: "GU-123 AB" → "GU123AB". */
export function makePlate(r: Rng, region: "DE" | "AT", codes: string[]): string {
  const code = r.pick(codes);
  const letters = (n: number) => Array.from({ length: n }, () => r.pick([...LETTERS])).join("");
  if (region === "DE") {
    const digits = String(r.int(1, r.chance(0.7) ? 9999 : 99));
    return normalize(`${code}-${letters(r.chance(0.6) ? 2 : 1)} ${digits}`);
  }
  const digits = String(r.int(1, r.chance(0.5) ? 99999 : 999));
  return normalize(`${code}-${digits} ${letters(r.chance(0.5) ? 2 : 1)}`);
}

/** A fleet: one prefix, numbers close together, as companies register their cars. */
export function makeFleet(r: Rng, region: "DE" | "AT", codes: string[], size: number): string[] {
  const code = r.pick(codes);
  const prefix = Array.from({ length: 2 }, () => r.pick([...LETTERS])).join("");
  const base = r.int(10, 980) * 10;
  const out = new Set<string>();
  while (out.size < size) {
    const n = base + r.int(0, 30);
    out.add(region === "DE" ? normalize(`${code}-${prefix} ${n}`) : normalize(`${code}-${n} ${prefix}`));
  }
  return [...out].sort();
}

const PARTNERS = new Map<string, string[]>();
for (const [a, b] of CONFUSABLE) {
  PARTNERS.set(a, [...(PARTNERS.get(a) ?? []), b]);
  PARTNERS.set(b, [...(PARTNERS.get(b) ?? []), a]);
}

/** How a licence-plate reader gets a plate wrong: mostly lookalike characters, sometimes a lost character. */
export function misread(r: Rng, plate: string, dropShare: number): string {
  const chars = [...plate];
  if (r.chance(dropShare) && chars.length > 3) {
    chars.splice(r.int(1, chars.length - 1), 1);
    return chars.join("");
  }
  const confusable = chars.map((c, i) => (PARTNERS.has(c) ? i : -1)).filter((i) => i >= 0);
  if (confusable.length > 0 && r.chance(0.85)) {
    const i = r.pick(confusable);
    chars[i] = r.pick(PARTNERS.get(chars[i]!)!);
  } else {
    const i = r.int(0, chars.length - 1);
    chars[i] = r.pick([..."ABCDEFGHKLMNPRSTUVWXYZ0123456789"].filter((c) => c !== chars[i]));
  }
  return chars.join("");
}

const KEYBOARD_NEIGHBOURS: Record<string, string> = {
  "1": "2Q", "2": "13W", "3": "24E", "4": "35R", "5": "46T", "6": "57Z", "7": "68U", "8": "79I", "9": "80O", "0": "9P",
  Q: "WA1", W: "QES2", E: "WRD3", R: "ETF4", T: "RZG5", Z: "TUH6", U: "ZIJ7", I: "UOK8", O: "IPL9", P: "O0",
  A: "QSY", S: "AWDX", D: "SEFC", F: "DRGV", G: "FTHB", H: "GZJN", J: "HUKM", K: "JIL", L: "KO",
  Y: "AX", X: "YSC", C: "XDV", V: "CFB", B: "VGN", N: "BHM", M: "NJ",
};

/** How a driver mistypes a plate at a terminal. */
export function typo(r: Rng, plate: string): string {
  const chars = [...plate];
  const kind = r.weighted({ neighbour: 0.4, missing: 0.25, swap: 0.2, lookalike: 0.15 });
  const i = r.int(0, chars.length - 1);
  if (kind === "neighbour") {
    const n = KEYBOARD_NEIGHBOURS[chars[i]!];
    if (n) chars[i] = r.pick([...n]);
  } else if (kind === "missing" && chars.length > 3) {
    chars.splice(i, 1);
  } else if (kind === "swap" && i < chars.length - 1) {
    [chars[i], chars[i + 1]] = [chars[i + 1]!, chars[i]!];
  } else {
    const p = PARTNERS.get(chars[i]!);
    if (p) chars[i] = r.pick(p);
  }
  return chars.join("");
}
