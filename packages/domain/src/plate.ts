/** Plates are compared in one normal form: upper case, letters and digits only. "M-AB 1234" becomes "MAB1234". */
export function normalize(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
}

/**
 * Pairs a licence-plate reader confuses, and how cheap the confusion is (0 = free, 1 = an ordinary substitution).
 * Shared vocabulary: the engine uses it to rank candidates; it says nothing about how often a scanner misreads.
 */
export const CONFUSABLE: ReadonlyArray<readonly [string, string, number]> = [
  ["O", "0", 0.15],
  ["D", "0", 0.3],
  ["Q", "0", 0.35],
  ["D", "O", 0.3],
  ["I", "1", 0.15],
  ["L", "1", 0.45],
  ["B", "8", 0.2],
  ["S", "5", 0.2],
  ["Z", "2", 0.25],
  ["G", "6", 0.3],
  ["A", "4", 0.45],
  ["T", "7", 0.45],
  ["M", "N", 0.4],
  ["H", "N", 0.5],
  ["U", "V", 0.45],
  ["E", "F", 0.4],
  ["C", "G", 0.45],
  ["K", "X", 0.5],
  ["Ö", "O", 0.2],
  ["Ü", "U", 0.2],
  ["Ä", "A", 0.2],
];

const COST = new Map<string, number>();
for (const [a, b, c] of CONFUSABLE) {
  COST.set(a + b, c);
  COST.set(b + a, c);
}

export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return COST.get(a + b) ?? 1;
}

/** Characters a reader can lose or invent cost less than a random substitution, more than a confusion. */
export const GAP_COST = 0.7;

/** Weighted edit distance between two normalised plates, with adjacent transpositions. */
export function plateDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > 2) return Math.abs(n - m) * GAP_COST + 1;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i * GAP_COST;
  for (let j = 0; j <= m; j++) d[0]![j] = j * GAP_COST;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const ai = a[i - 1]!;
      const bj = b[j - 1]!;
      let v = Math.min(
        d[i - 1]![j]! + GAP_COST,
        d[i]![j - 1]! + GAP_COST,
        d[i - 1]![j - 1]! + substitutionCost(ai, bj),
      );
      if (i > 1 && j > 1 && ai === b[j - 2] && a[i - 2] === bj && ai !== bj) v = Math.min(v, d[i - 2]![j - 2]! + 0.6);
      d[i]![j] = v;
    }
  }
  return d[n]![m]!;
}

/** Plain Levenshtein distance, what a generic fuzzy match uses. */
export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}
