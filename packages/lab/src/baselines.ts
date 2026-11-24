import {
  type Account,
  type CropReader,
  type EdgeEvent,
  type PassView,
  type PaymentEvent,
  type PaymentProvider,
  type ReadEvent,
  type SiteInfo,
  type Tariff,
  feeCents,
  levenshtein,
  MINUTE,
  plateDistance,
} from "@pse/domain";
import { type Outcome, PlateIndex, type SessionRef } from "@pse/engine";

/**
 * How ticketless sites are often run today: one open session per plate, exact plate equality, a notice when no
 * payment carries the same plate, and a retry when the payment provider times out.
 *
 * - "exact": nothing more.
 * - "fuzzy": when no plate matches exactly, take the most recent open entry one edit away; same for payments.
 * - "model": when no plate matches exactly, a vision model picks among the closest open entries, and its pick stands.
 */
export type BaselineMode = "exact" | "fuzzy" | "model";

interface Entry {
  read: ReadEvent;
  reads: string[];
}

export class BaselineDesk {
  readonly outcomes: Outcome[] = [];
  operatorMinutes = 0;
  modelCalls = 0;
  private readonly seen = new Set<string>();
  private readonly open = new Map<string, Map<string, Entry>>();
  private readonly fuzzy = new Map<string, PlateIndex<Entry>>();
  private readonly lastRead = new Map<string, ReadEvent>();
  private readonly payments = new Map<string, PaymentEvent[]>();
  private readonly accounts = new Map<string, string>();
  private readonly siteTariff = new Map<string, Tariff>();
  private n = 0;

  constructor(
    private readonly mode: BaselineMode,
    tariffs: Record<string, Tariff>,
    sites: SiteInfo[],
    accounts: Account[],
    private readonly psp: PaymentProvider,
    private readonly reader: CropReader | null,
  ) {
    for (const a of accounts) this.accounts.set(a.plate, a.id);
    for (const s of sites) {
      this.siteTariff.set(s.id, tariffs[s.tariff]!);
      this.open.set(s.id, new Map());
      this.fuzzy.set(s.id, new PlateIndex<Entry>(mode !== "fuzzy"));
      this.payments.set(s.id, []);
    }
  }

  ingest(e: EdgeEvent): void {
    if (this.seen.has(e.id)) return;
    this.seen.add(e.id);
    if (e.kind === "payment") {
      this.payments.get(e.site)!.push(e);
      return;
    }
    if (e.kind !== "read") return;
    const prev = this.lastRead.get(e.scanner);
    if (prev && prev.plate === e.plate && Math.abs(prev.at - e.at) < 10_000) {
      return;
    }
    this.lastRead.set(e.scanner, e);
    const open = this.open.get(e.site)!;
    const index = this.fuzzy.get(e.site)!;
    if (e.direction === "in") {
      if (open.has(e.plate)) return; // "vehicle already inside": the earlier session runs on
      const entry = { read: e, reads: [e.id] };
      open.set(e.plate, entry);
      index.add(entry, [e.plate]);
      return;
    }
    let entry = open.get(e.plate);
    if (!entry && this.mode === "fuzzy") {
      entry = index
        .query([e.plate])
        .filter((x) => levenshtein(x.read.plate, e.plate) <= 1 && x.read.at < e.at)
        .sort((a, b) => b.read.at - a.read.at || (a.read.id < b.read.id ? -1 : 1))[0];
    }
    if (!entry && this.mode === "model" && this.reader) {
      const near = index
        .query([e.plate])
        .filter((x) => x.read.at < e.at)
        .sort((a, b) => plateDistance(a.read.plate, e.plate) - plateDistance(b.read.plate, e.plate) || (a.read.id < b.read.id ? -1 : 1))
        .slice(0, 6);
      if (near.length > 0) {
        this.modelCalls++;
        const view = (r: ReadEvent): PassView => ({ id: r.id, scanner: r.scanner, reads: [{ id: r.id, plate: r.plate, confidence: r.confidence, colour: r.colour, make: r.make, at: r.at }] });
        const answer = this.reader.compare({ site: e.site, exit: view(e), candidates: near.map((x) => view(x.read)) });
        entry = near.find((x) => x.read.id === answer.candidate);
      }
    }
    if (!entry) {
      this.outcomes.push({ kind: "write-off", reason: "missed-entry", ...this.ref(e, null, e.plate) });
      return;
    }
    open.delete(entry.read.plate);
    index.remove(entry);
    this.bill(e, entry);
  }

  finish(): void {}

  private bill(exit: ReadEvent, entry: Entry): void {
    const plate = this.accounts.has(entry.read.plate) ? entry.read.plate : exit.plate;
    const fee = feeCents(this.siteTariff.get(exit.site)!, Math.max(0, exit.at - entry.read.at));
    const ref = this.ref(exit, entry, plate);
    if (fee === 0) return void this.outcomes.push({ kind: "free", ...ref });
    const account = this.accounts.get(plate);
    if (account) {
      for (let attempts = 1; attempts <= 3; attempts++) {
        if (this.psp.charge({ account, amountCents: fee, ref: ref.session }) === "ok") {
          return void this.outcomes.push({ kind: "charge", account, amountCents: fee, attempts, ...ref });
        }
      }
      return void this.outcomes.push({ kind: "write-off", reason: "charge-failed", ...ref });
    }
    const pool = this.payments.get(exit.site)!;
    const fits = (p: PaymentEvent) =>
      p.at >= entry.read.at - 5 * MINUTE &&
      p.at <= exit.at + 5 * MINUTE &&
      (p.plate === plate || p.plate === entry.read.plate || (this.mode === "fuzzy" && levenshtein(p.plate, plate) <= 1));
    const paid = pool.find(fits);
    if (paid) {
      pool.splice(pool.indexOf(paid), 1);
      return void this.outcomes.push({ kind: "paid", payment: paid.id, ...ref });
    }
    this.outcomes.push({ kind: "notice", amountCents: fee, ...ref });
  }

  private ref(exit: ReadEvent, entry: Entry | null, plate: string): SessionRef {
    return {
      session: `b-${++this.n}-${exit.id}`,
      site: exit.site,
      plate,
      entryReads: entry ? entry.reads : [],
      exitReads: [exit.id],
      entryAt: entry ? entry.read.at : null,
      exitAt: exit.at,
      decidedAt: exit.sentAt,
    };
  }
}
