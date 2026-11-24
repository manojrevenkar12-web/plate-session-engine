import type { EdgeEvent, ReviewAnswer } from "@pse/domain";
import type { Outcome } from "@pse/engine";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/client.js";
import type { ChargeRow, Store, StoredAnswer } from "./store.js";

const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Postgres through Prisma 7 and the pg driver adapter. Unique constraints make every write idempotent. */
export class PrismaStore implements Store {
  readonly db: PrismaClient;

  constructor(url: string) {
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }

  async appendEvent(e: EdgeEvent): Promise<boolean> {
    try {
      await this.db.edgeEvent.create({
        data: { id: e.id, kind: e.kind, site: e.site, scanner: "scanner" in e ? e.scanner : null, sentAt: BigInt(e.sentAt), payload: e as unknown as Prisma.InputJsonValue },
      });
      return true;
    } catch (err) {
      if (unique(err)) return false;
      throw err;
    }
  }

  /** One INSERT for the whole batch; the unique id makes it idempotent, RETURNING says which rows were new. */
  async appendEvents(events: EdgeEvent[]): Promise<Set<string>> {
    if (events.length === 0) return new Set();
    const rows = await this.db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO "edge_event" ("id", "kind", "site", "scanner", "sent_at", "payload")
       SELECT t.id, t.kind, t.site, t.scanner, t.sent_at, t.payload FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]::bigint[], $6::text[]::jsonb[]) WITH ORDINALITY AS t(id, kind, site, scanner, sent_at, payload, n)
       ORDER BY t.n
       ON CONFLICT ("id") DO NOTHING RETURNING "id"`,
      events.map((e) => e.id),
      events.map((e) => e.kind),
      events.map((e) => e.site),
      events.map((e) => ("scanner" in e ? e.scanner : null)),
      events.map((e) => String(e.sentAt)),
      events.map((e) => JSON.stringify(e)),
    );
    return new Set(rows.map((r) => r.id));
  }

  async *events(): AsyncIterable<EdgeEvent> {
    let after = 0n;
    for (;;) {
      const page = await this.db.edgeEvent.findMany({ where: { seq: { gt: after } }, orderBy: { seq: "asc" }, take: 5000 });
      if (page.length === 0) return;
      for (const row of page) yield row.payload as unknown as EdgeEvent;
      after = page[page.length - 1]!.seq;
    }
  }

  async saveOutcome(o: Outcome): Promise<boolean> {
    try {
      await this.db.outcome.create({
        data: {
          session: o.session,
          kind: o.kind,
          site: o.site,
          plate: o.plate,
          amountCents: "amountCents" in o ? o.amountCents : null,
          decidedAt: BigInt(o.decidedAt),
          payload: o as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      if (unique(err)) return false;
      throw err;
    }
  }

  async outcomes(f: { site?: string; plate?: string; limit?: number }): Promise<Outcome[]> {
    const rows = await this.db.outcome.findMany({
      where: { ...(f.site ? { site: f.site } : {}), ...(f.plate ? { plate: f.plate } : {}) },
      orderBy: { decidedAt: "desc" },
      take: f.limit ?? 100,
    });
    return rows.map((r) => r.payload as unknown as Outcome);
  }

  async enqueueCharge(c: Omit<ChargeRow, "status" | "attempts">): Promise<boolean> {
    try {
      await this.db.charge.create({ data: { key: c.key, account: c.account, amountCents: c.amountCents, ref: c.ref } });
      return true;
    } catch (err) {
      if (unique(err)) return false;
      throw err;
    }
  }

  async pendingCharges(limit: number): Promise<ChargeRow[]> {
    const rows = await this.db.charge.findMany({ where: { status: "pending" }, orderBy: { updatedAt: "asc" }, take: limit });
    return rows.map((r) => ({ key: r.key, account: r.account, amountCents: r.amountCents, ref: r.ref, status: r.status as ChargeRow["status"], attempts: r.attempts }));
  }

  async markCharge(key: string, status: ChargeRow["status"], attempts: number): Promise<void> {
    await this.db.charge.update({ where: { key }, data: { status, attempts } });
  }

  async saveAnswer(a: StoredAnswer): Promise<boolean> {
    try {
      await this.db.reviewAnswer.create({
        data: { itemId: a.itemId, answer: a.answer as unknown as Prisma.InputJsonValue, minutes: a.minutes, at: BigInt(a.at), operator: a.operator },
      });
      return true;
    } catch (err) {
      if (unique(err)) return false;
      throw err;
    }
  }

  async answers(): Promise<StoredAnswer[]> {
    const rows = await this.db.reviewAnswer.findMany({ orderBy: { at: "asc" } });
    return rows.map((r) => ({ itemId: r.itemId, answer: r.answer as unknown as ReviewAnswer, minutes: r.minutes, at: Number(r.at), operator: r.operator }));
  }

  async close(): Promise<void> {
    await this.db.$disconnect();
  }
}
