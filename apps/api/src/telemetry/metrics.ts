/** Counters and gauges in OpenMetrics text; the Datadog Agent's OpenMetrics check scrapes /metrics. */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, () => number>();
  private readonly latencies: number[] = [];

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  gauge(name: string, read: () => number): void {
    this.gauges.set(name, read);
  }

  observeIngestMs(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 10_000) this.latencies.splice(0, this.latencies.length - 10_000);
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  quantile(q: number): number {
    if (this.latencies.length === 0) return 0;
    const s = [...this.latencies].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  }

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of [...this.counters.entries()].sort()) lines.push(`# TYPE pse_${k} counter`, `pse_${k}_total ${v}`);
    for (const [k, f] of [...this.gauges.entries()].sort()) lines.push(`# TYPE pse_${k} gauge`, `pse_${k} ${f()}`);
    lines.push("# TYPE pse_ingest_latency_ms summary", `pse_ingest_latency_ms{quantile="0.5"} ${this.quantile(0.5)}`, `pse_ingest_latency_ms{quantile="0.99"} ${this.quantile(0.99)}`);
    return lines.join("\n") + "\n# EOF\n";
  }
}

export const METRICS = Symbol("METRICS");
