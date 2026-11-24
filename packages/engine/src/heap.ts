/** A small binary min-heap ordered by `at`, ties broken by insertion order so runs are deterministic. */
export class TimeHeap<T> {
  private items: { at: number; n: number; value: T }[] = [];
  private counter = 0;

  get size(): number {
    return this.items.length;
  }

  push(at: number, value: T): void {
    const items = this.items;
    items.push({ at, n: this.counter++, value });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [items[i], items[p]] = [items[p]!, items[i]!];
      i = p;
    }
  }

  peekAt(): number {
    return this.items[0]?.at ?? Infinity;
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top.value;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a]!;
    const y = this.items[b]!;
    return x.at < y.at || (x.at === y.at && x.n < y.n);
  }
}
