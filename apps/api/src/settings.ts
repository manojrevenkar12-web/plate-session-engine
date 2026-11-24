import { readFileSync } from "node:fs";
import type { Account, SiteInfo } from "@pse/domain";

export interface Settings {
  port: number;
  /** Postgres through Prisma; unset keeps everything in memory (development and tests) */
  databaseUrl: string | null;
  /** Redis for BullMQ; unset processes inline */
  redisUrl: string | null;
  /** edge events are split into this many ordered queues by site; each is consumed by one worker */
  shards: number;
  /** all: ingest, engine and workers in one process; ingest: accept and queue only; engine: consume one shard */
  role: "all" | "ingest" | "engine";
  shard: number;
  sitesFile: string;
  tickMs: number;
  edgeToken: string | null;
  operatorToken: string | null;
  anthropicKey: string | null;
  cropModel: string;
  pspUrl: string | null;
}

export const SETTINGS = Symbol("SETTINGS");
export const STORE = Symbol("STORE");

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Settings {
  const role = (env.PSE_ROLE ?? "all") as Settings["role"];
  if (!["all", "ingest", "engine"].includes(role)) throw new Error(`PSE_ROLE must be all, ingest or engine, not "${role}"`);
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? null,
    redisUrl: env.REDIS_URL ?? null,
    shards: Number(env.PSE_SHARDS ?? 1),
    role,
    shard: Number(env.PSE_SHARD ?? 0),
    sitesFile: env.PSE_SITES_FILE ?? new URL("../demo/sites.json", import.meta.url).pathname,
    tickMs: Number(env.PSE_TICK_MS ?? 5000),
    edgeToken: env.PSE_EDGE_TOKEN ?? null,
    operatorToken: env.PSE_OPERATOR_TOKEN ?? null,
    anthropicKey: env.ANTHROPIC_API_KEY ?? null,
    cropModel: env.PSE_CROP_MODEL ?? "claude-haiku-4-5",
    pspUrl: env.PSE_PSP_URL ?? null,
  };
}

/** Product data: which scanners are installed where, and who registered for Automatic Payment. */
export function loadSites(file: string): { sites: SiteInfo[]; accounts: Account[] } {
  return JSON.parse(readFileSync(file, "utf8")) as { sites: SiteInfo[]; accounts: Account[] };
}

export function shardOf(site: string, shards: number): number {
  let h = 2166136261;
  for (let i = 0; i < site.length; i++) h = Math.imul(h ^ site.charCodeAt(i), 16777619);
  return (h >>> 0) % shards;
}
