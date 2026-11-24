/**
 * Measures the ingest endpoint: reads a second and the p99 latency of a batch, with the store and queue the
 * environment configures (memory and inline by default; Postgres and BullMQ with DATABASE_URL and REDIS_URL).
 * Writes the result to reports/bench.json. Measured, not simulated.
 */
import "reflect-metadata";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ROOT } from "@pse/engine";
import { AppModule } from "./app.module.js";
import { loadSites, settingsFromEnv } from "./settings.js";

const BATCHES = Number(process.env.BENCH_BATCHES ?? 400);
const PER_BATCH = Number(process.env.BENCH_PER_BATCH ?? 50);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 8);

const settings = { ...settingsFromEnv(), port: 0, edgeToken: null, operatorToken: null };
const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(settings, { reader: null }), new FastifyAdapter({ bodyLimit: 2_000_000 }), { logger: false });
await app.listen(0, "127.0.0.1");
const url = `${await app.getUrl()}/v1/edge/events`;
const { sites } = loadSites(settings.sitesFile);
const scanners = sites.flatMap((s) => s.scanners.map((sc) => ({ ...sc, site: s.id })));
const t0 = Date.now();
let seq = 0;
const batch = () =>
  Array.from({ length: PER_BATCH }, () => {
    const i = seq++;
    const sc = scanners[i % scanners.length]!;
    return { kind: "read", id: `b-${i}`, scanner: sc.id, site: sc.site, direction: sc.direction, at: t0 + i * 1000, plate: `MB${String(10_000 + (i % 9000)).slice(1)}`, confidence: 0.95, colour: "grey", make: "VW" };
  });
const latencies: number[] = [];
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next++ < BATCHES) {
      const a = performance.now();
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: batch() }) });
      if (res.status !== 202) throw new Error(`ingest answered ${res.status}: ${await res.text()}`);
      latencies.push(performance.now() - a);
    }
  }),
);
const seconds = (performance.now() - started) / 1000;
await app.close();
latencies.sort((a, b) => a - b);
const api = {
  readsPerSecond: Math.round((BATCHES * PER_BATCH) / seconds),
  p99ms: Math.round(latencies[Math.floor(latencies.length * 0.99)]! * 10) / 10,
  batch: PER_BATCH,
  concurrency: CONCURRENCY,
  store: settings.databaseUrl ? "Postgres via Prisma" : "in-memory store",
  queue: settings.redisUrl ? `BullMQ on Redis, ${settings.shards} shard(s)` : "inline",
  machine: `${cpus()[0]?.model.trim() ?? "unknown CPU"}, Node ${process.version}`,
};
const file = join(ROOT, "reports", "bench.json");
const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
writeFileSync(file, JSON.stringify({ ...prev, api }, null, 1) + "\n");
console.log(api);
