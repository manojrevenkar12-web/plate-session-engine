export const pct = (x: number, d = 1): string => `${(100 * x).toFixed(d)}%`;
export const num = (x: number, d = 0): string => x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
export const eur = (cents: number): string => `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Which characters of `plate` differ from `reference`: a longest-common-subsequence alignment, so a dropped or
 * swapped character is marked where it happened rather than shifting every character after it.
 */
export function differing(plate: string, reference: string): boolean[] {
  const a = [...plate];
  const b = [...reference];
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const keep = new Array<boolean>(a.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keep[i] = true;
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return keep.map((k) => !k);
}
