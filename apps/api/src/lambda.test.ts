import type { EdgeEvent } from "@pse/domain";
import { MemoryStore } from "@pse/store";
import { describe, expect, it } from "vitest";
import { type Deps, handle } from "./lambda.js";

const deps = (): Deps & { queued: [number, EdgeEvent[]][] } => {
  const queued: [number, EdgeEvent[]][] = [];
  return {
    queued,
    store: new MemoryStore(),
    shards: 4,
    edgeToken: "t0k",
    scannerSite: new Map([["s-in", "site-a"]]),
    sites: new Set(["site-a"]),
    now: () => 1_000,
    enqueue: async (s, list) => void queued.push([s, list]),
  };
};
const body = (events: object[]) => JSON.stringify({ events });
const read = { kind: "read", id: "r1", scanner: "s-in", site: "site-a", direction: "in", at: 900, plate: "m-ab 1234", confidence: 0.9 };

describe("the Lambda ingest", () => {
  it("stores once, queues on the site's shard and stamps arrival time", async () => {
    const d = deps();
    const first = await handle({ headers: { "x-edge-token": "t0k" }, body: body([read, read]) }, d);
    expect(first.statusCode).toBe(202);
    expect(JSON.parse(first.body)).toEqual({ accepted: 1, duplicates: 1 });
    expect(d.queued).toHaveLength(1);
    expect(d.queued[0]![1][0]).toMatchObject({ plate: "MAB1234", sentAt: 1_000 });
    const again = await handle({ headers: { "x-edge-token": "t0k" }, body: Buffer.from(body([read])).toString("base64"), isBase64Encoded: true }, d);
    expect(JSON.parse(again.body)).toEqual({ accepted: 0, duplicates: 1 });
  });

  it("refuses a wrong token, bad JSON, a bad event and a scanner on the wrong site", async () => {
    const d = deps();
    expect((await handle({ headers: {}, body: body([read]) }, d)).statusCode).toBe(401);
    expect((await handle({ headers: { "x-edge-token": "t0k" }, body: "{" }, d)).statusCode).toBe(400);
    expect((await handle({ headers: { "x-edge-token": "t0k" }, body: body([{ kind: "read" }]) }, d)).statusCode).toBe(400);
    expect((await handle({ headers: { "x-edge-token": "t0k" }, body: body([{ ...read, site: "site-b" }]) }, d)).statusCode).toBe(422);
  });
});
