import { normalize } from "@pse/domain";
import { z } from "zod";

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const ms = z.number().int().nonnegative();

const read = z.object({
  kind: z.literal("read"),
  id,
  scanner: id,
  site: id,
  direction: z.enum(["in", "out"]),
  at: ms,
  plate: z.string().min(1).max(16).transform(normalize).pipe(z.string().min(2)),
  confidence: z.number().min(0).max(1),
  colour: z.string().max(20).default("unknown"),
  make: z.string().max(30).default("unknown"),
  cropUrl: z.url({ protocol: /^https$/ }).optional(),
});

const payment = z.object({
  kind: z.literal("payment"),
  id,
  site: id,
  plate: z.string().min(1).max(16).transform(normalize).pipe(z.string().min(2)),
  at: ms,
  amountCents: z.number().int().nonnegative().max(1_000_000),
  channel: z.enum(["terminal", "app"]),
});

const heartbeat = z.object({ kind: z.literal("heartbeat"), id, scanner: id, site: id, at: ms });

/** A batch from an edge device or a payment channel. The server stamps when it received each event. */
export const batchSchema = z.object({ events: z.array(z.discriminatedUnion("kind", [read, payment, heartbeat])).min(1).max(1000) });

export type Batch = z.infer<typeof batchSchema>;

export const answerSchema = z.object({
  answer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("orphan-exit"), entry: z.string().nullable() }),
    z.object({ kind: z.literal("missed-exit"), exitAt: ms.nullable() }),
    z.object({ kind: z.literal("payment"), payment: z.string().nullable() }),
    z.object({ kind: z.literal("plate"), plate: z.string().max(16).transform(normalize).nullable() }),
  ]),
  minutes: z.number().min(0).max(120).default(0),
  operator: z.string().min(1).max(80),
});
