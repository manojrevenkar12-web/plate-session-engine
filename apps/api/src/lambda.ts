/**
 * The high-throughput front door on AWS Lambda behind API Gateway (deployed with the Serverless Framework, see
 * serverless.yml). It does what the NestJS ingest endpoint does and nothing more: check the edge token, validate,
 * store each event once in one INSERT, and queue the new ones on their shard. The engine runs in the cluster.
 */
import { timingSafeEqual } from "node:crypto";
import type { EdgeEvent } from "@pse/domain";
import { PrismaStore, type Store } from "@pse/store";
import { Queue } from "bullmq";
import { jobId } from "./job-id.js";
import { batchSchema } from "./ingest/schema.js";
import { loadSites, shardOf } from "./settings.js";

interface HttpEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
}
interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface Deps {
  store: Store;
  enqueue: (shard: number, events: EdgeEvent[]) => Promise<void>;
  shards: number;
  edgeToken: string | null;
  scannerSite: Map<string, string>;
  sites: Set<string>;
  now: () => number;
}

const json = (statusCode: number, body: unknown): HttpResult => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function handle(event: HttpEvent, deps: Deps): Promise<HttpResult> {
  if (deps.edgeToken) {
    const given = event.headers?.["x-edge-token"] ?? "";
    if (given.length !== deps.edgeToken.length || !timingSafeEqual(Buffer.from(given), Buffer.from(deps.edgeToken))) return json(401, { message: "a valid edge token is required" });
  }
  let body: unknown;
  try {
    body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? ""));
  } catch {
    return json(400, { message: "body is not JSON" });
  }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return json(400, { message: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
  for (const e of parsed.data.events) {
    if (e.kind !== "payment" && deps.scannerSite.get(e.scanner) !== e.site) return json(422, { message: `scanner ${e.scanner} is not installed at ${e.site}` });
    if (e.kind === "payment" && !deps.sites.has(e.site)) return json(422, { message: `unknown site ${e.site}` });
  }
  const receivedAt = deps.now();
  const events = parsed.data.events.map((e) => ({ ...e, sentAt: receivedAt }) as EdgeEvent);
  const fresh = await deps.store.appendEvents(events);
  const seen = new Set<string>();
  const queued = events.filter((e) => fresh.has(e.id) && !seen.has(e.id) && seen.add(e.id));
  const byShard = new Map<number, EdgeEvent[]>();
  for (const e of queued) byShard.set(shardOf(e.site, deps.shards), [...(byShard.get(shardOf(e.site, deps.shards)) ?? []), e]);
  await Promise.all([...byShard.entries()].map(([s, list]) => deps.enqueue(s, list)));
  return json(202, { accepted: queued.length, duplicates: events.length - queued.length });
}

let cached: Deps | null = null;

/** Lambda entry point. Connections are created once per container and reused across invocations. */
export async function handler(event: HttpEvent): Promise<HttpResult> {
  if (!cached) {
    const env = process.env;
    const { sites } = loadSites(env.PSE_SITES_FILE ?? new URL("../demo/sites.json", import.meta.url).pathname);
    const shards = Number(env.PSE_SHARDS ?? 1);
    const connection = { url: env.REDIS_URL!, maxRetriesPerRequest: null };
    const queues = new Map<number, Queue>();
    cached = {
      store: new PrismaStore(env.DATABASE_URL!),
      shards,
      edgeToken: env.PSE_EDGE_TOKEN ?? null,
      scannerSite: new Map(sites.flatMap((s) => s.scanners.map((sc) => [sc.id, s.id] as const))),
      sites: new Set(sites.map((s) => s.id)),
      now: Date.now,
      enqueue: async (shard, list) => {
        let q = queues.get(shard);
        if (!q) queues.set(shard, (q = new Queue(`edge-${shard}`, { connection })));
        await q.add("events", { events: list }, { jobId: jobId(list.map((e) => e.id).join("|")), removeOnComplete: 1000, removeOnFail: 5000 });
      },
    };
  }
  return handle(event, cached);
}
