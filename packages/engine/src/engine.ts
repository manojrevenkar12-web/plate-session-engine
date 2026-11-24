import {
  type Account,
  type CropAnswer,
  type CropReader,
  type Direction,
  type EdgeEvent,
  type HeartbeatEvent,
  type PassView,
  type PaymentEvent,
  type PaymentProvider,
  type ReadEvent,
  type ReadView,
  type ReviewAnswer,
  type Reviewer,
  type ReviewItem,
  type SiteInfo,
  type SiteKind,
  type Tariff,
  feeCents,
  HOUR,
  MINUTE,
  plateDistance,
} from "@pse/domain";
import type { EngineConfig } from "./config.js";
import { TimeHeap } from "./heap.js";
import type { Alarm, EngineStats, Outcome, SessionRef } from "./outcomes.js";
import { PlateIndex } from "./plate-index.js";

/** Switches for the lab's ablations. Production runs with every one on. */
export interface EngineOptions {
  /** hold an exit until every entry scanner on site has reported past it */
  watermark: boolean;
  /** estimate each scanner's clock offset from its heartbeats and correct it */
  skew: boolean;
  /** weigh colour, make and length of stay, not only the plate */
  evidence: boolean;
  /** send what code cannot settle to a person; off means take the best guess */
  review: boolean;
  /** ask a vision model to compare crops before a person, and verify its answer in code */
  agent: boolean;
  /** pay with an idempotency key, so a retry after a timeout cannot charge twice */
  idempotency: boolean;
  /** missed exits, typed-plate payments and duplicate reads handled with care */
  quality: boolean;
  /** watch every scanner's read quality and raise a ticket when it drifts */
  health: boolean;
}

export const ALL_ON: EngineOptions = {
  watermark: true,
  skew: true,
  evidence: true,
  review: true,
  agent: true,
  idempotency: true,
  quality: true,
  health: true,
};

export interface Ports {
  psp: PaymentProvider;
  reviewer: Reviewer;
  reader: CropReader | null;
}

interface Pass {
  id: string;
  scanner: string;
  site: string;
  direction: Direction;
  at: number;
  reads: ReadView[];
  firstSentAt: number;
  lastSentAt: number;
  consumed: boolean;
  decided: boolean;
  staleChecked: boolean;
}

interface ScannerState {
  id: string;
  site: string;
  direction: Direction;
  watermark: number;
  lastHeartbeat: number;
  stableAfter: number;
  offsets: number[];
  correction: number;
  /** passes by 10-second bucket of scanner time, so a late duplicate finds its pass even after a backlog flush */
  buckets: Map<number, Pass[]>;
  cusum: number;
  degradedAlarm: boolean;
  offlineAlarm: boolean;
}

interface SiteState {
  info: SiteInfo;
  kind: SiteKind;
  tariff: Tariff;
  open: PlateIndex<Pass>;
  openList: Set<Pass>;
  openExact: Map<string, Set<Pass>>;
  pending: Set<Pass>;
  payments: PaymentEvent[];
  inScanners: ScannerState[];
}

type Task =
  | { kind: "check-exit"; pass: Pass }
  | { kind: "settle-payment"; session: Session }
  | { kind: "sweep" };

interface Session {
  id: string;
  site: SiteState;
  entry: Pass | null;
  exit: Pass | null;
  entryAt: number;
  exitAt: number;
  plate: string;
  spellings: string[];
  posterior: number;
}

const BUCKET = 10_000;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class SessionEngine {
  readonly outcomes: Outcome[] = [];
  readonly alarms: Alarm[] = [];
  readonly stats: EngineStats = {
    events: 0,
    duplicates: 0,
    passes: 0,
    exits: 0,
    exact: 0,
    auto: 0,
    agentAsked: 0,
    agentAccepted: 0,
    reviews: 0,
    operatorMinutes: 0,
    held: 0,
    skewCorrected: 0,
    missedExits: 0,
  };
  /** what each charge waited for, from exit to decision, ms */
  readonly decisionDelays: number[] = [];

  private now = -Infinity;
  private readonly seen = new Set<string>();
  private readonly sites = new Map<string, SiteState>();
  private readonly scanners = new Map<string, ScannerState>();
  private readonly accounts = new Map<string, string>();
  private readonly tasks = new TimeHeap<Task>();
  private readonly charged = new Set<string>();
  private sessionCounter = 0;
  private readonly formats: RegExp[];
  private readonly registeredIndex = new PlateIndex<string>();
  private nextSweep = -Infinity;
  private nextStaleCheck = -Infinity;
  private finishing = false;
  private readonly waiting = new Map<
    string,
    { item: ReviewItem; resume: (a: ReviewAnswer) => void; since: number; verify?: (a: CropAnswer) => ReviewAnswer | "suggest" }
  >();

  constructor(
    private readonly cfg: EngineConfig,
    tariffs: Record<string, Tariff>,
    sites: SiteInfo[],
    accounts: Account[],
    private readonly ports: Ports,
    private readonly opts: EngineOptions = ALL_ON,
  ) {
    for (const a of accounts) {
      this.accounts.set(a.plate, a.id);
      this.registeredIndex.add(a.plate, [a.plate]);
    }
    this.formats = cfg.plateFormats.map((f) => new RegExp(f));
    for (const info of sites) {
      const tariff = tariffs[info.tariff];
      if (!tariff) throw new Error(`no tariff "${info.tariff}" for ${info.id}`);
      const site: SiteState = {
        info,
        kind: info.kind,
        tariff,
        open: new PlateIndex<Pass>(),
        openList: new Set(),
        openExact: new Map(),
        pending: new Set(),
        payments: [],
        inScanners: [],
      };
      this.sites.set(info.id, site);
      for (const s of info.scanners) {
        const st: ScannerState = {
          id: s.id,
          site: info.id,
          direction: s.direction,
          watermark: -Infinity,
          lastHeartbeat: -Infinity,
          stableAfter: -Infinity,
          offsets: [],
          correction: 0,
          buckets: new Map(),
          cusum: 0,
          degradedAlarm: false,
          offlineAlarm: false,
        };
        this.scanners.set(s.id, st);
        if (s.direction === "in") site.inScanners.push(st);
      }
    }
  }

  /** Feed one event as the cloud receives it. Idempotent: an event id seen before is ignored. */
  ingest(e: EdgeEvent): void {
    this.advance(e.sentAt);
    this.stats.events++;
    if (this.seen.has(e.id)) {
      this.stats.duplicates++;
      return;
    }
    this.seen.add(e.id);
    if (e.kind === "heartbeat") this.heartbeat(e);
    else if (e.kind === "read") this.read(e);
    else this.payment(e);
  }

  /** Let the clock run to `until` with no more events, so held and scheduled decisions are taken. */
  finish(until: number): void {
    // No more events arrive: an open entry from here on is a car still parked, not a missed exit.
    this.finishing = true;
    this.advance(until);
    for (const site of [...this.sites.values()]) {
      for (const p of [...site.pending].sort((a, b) => a.at - b.at || byId(a, b))) this.decideExit(p);
    }
    this.advance(until + 1);
  }

  /** Let the clock run to `now` with no event: what a server does on a timer. */
  tick(now: number): void {
    this.advance(now);
  }

  /** Cars on site the engine believes are parked now. */
  openEntries(siteId: string): number {
    return this.sites.get(siteId)?.openList.size ?? 0;
  }

  /** Each scanner as the engine sees it: when it was last heard, its clock correction and its health. */
  scannerStatus(): { id: string; site: string; direction: Direction; lastHeartbeat: number | null; correctionMs: number; cusum: number; degraded: boolean; offline: boolean }[] {
    return [...this.scanners.values()].map((s) => ({
      id: s.id,
      site: s.site,
      direction: s.direction,
      lastHeartbeat: Number.isFinite(s.lastHeartbeat) ? s.lastHeartbeat : null,
      correctionMs: s.correction,
      cusum: Math.round(s.cusum * 100) / 100,
      degraded: s.degradedAlarm,
      offline: s.offlineAlarm,
    }));
  }

  // ---------------------------------------------------------------- clock

  private advance(t: number): void {
    if (t < this.now) return;
    this.now = t;
    while (this.tasks.size > 0 && this.tasks.peekAt() <= t) this.run(this.tasks.pop()!);
    if (t >= this.nextSweep) {
      this.nextSweep = t + MINUTE;
      this.sweep();
    }
  }

  private run(task: Task): void {
    if (task.kind === "check-exit") {
      if (!task.pass.decided && this.ready(task.pass)) this.decideExit(task.pass);
    } else if (task.kind === "settle-payment") {
      this.settleUnregistered(task.session);
    }
  }

  /**
   * Is a review worth an operator's time? Its expected value is the fee a typical stay at this site brings, times
   * the chance the operator settles it, times the chance the money comes in; its cost is the operator's minutes.
   */
  private worthReview(site: SiteState, kind: "orphan-exit" | "missed-exit", plate: string): boolean {
    const e = this.cfg.reviewEconomics;
    const typical = feeCents(site.tariff, this.cfg.stayPriors[site.kind].median * MINUTE);
    const collect = this.accounts.has(plate) ? 1 : e.noticePayRate;
    return typical * e.findRate * collect >= e.minutes[kind] * e.operatorCentsPerMinute;
  }

  private prune(sc: ScannerState): void {
    const keep = Math.floor((this.now - 3 * 24 * HOUR) / BUCKET);
    for (const k of [...sc.buckets.keys()]) if (k < keep) sc.buckets.delete(k);
  }

  /** Entries open far longer than the site's stays: probably a missed exit. An operator checks the exit cameras. */
  private staleCheck(): void {
    if (!this.opts.quality || !this.opts.review || this.finishing) return;
    for (const site of this.sites.values()) {
      const prior = this.cfg.stayPriors[site.kind];
      const limit = prior.median * Math.exp(this.cfg.staleAfterSigma * prior.sigma) * MINUTE;
      for (const p of [...site.openList]) {
        if (p.consumed || p.staleChecked || this.now - p.at < limit) continue;
        p.staleChecked = true;
        if (!this.worthReview(site, "missed-exit", this.bestPlate(p))) continue;
        const item = { kind: "missed-exit" as const, id: `st-${p.id}`, site: site.info.id, entry: this.view(p), before: this.now };
        this.review(item, (answer) => {
          if (answer.kind !== "missed-exit" || answer.exitAt === null || p.consumed) return;
          this.consume(site, p);
          this.stats.missedExits++;
          this.bill(this.session(site, p, null, this.bestPlate(p), 1, answer.exitAt));
        });
      }
    }
  }

  private sweep(): void {
    // A reconnected scanner's settle period ends without an event: recheck what waits on it.
    for (const site of this.sites.values()) {
      if (site.pending.size === 0) continue;
      for (const p of [...site.pending].sort((a, b) => a.at - b.at || byId(a, b))) if (this.ready(p)) this.decideExit(p);
    }
    if (this.now >= this.nextStaleCheck) {
      this.nextStaleCheck = this.now + 15 * MINUTE;
      this.staleCheck();
    }
    const limit = this.cfg.health.offlineMinutes * MINUTE;
    for (const sc of this.scanners.values()) {
      if (sc.lastHeartbeat === -Infinity || sc.offlineAlarm) continue;
      if (this.now - sc.lastHeartbeat > limit) {
        sc.offlineAlarm = true;
        if (this.opts.health) this.alarms.push({ scanner: sc.id, site: sc.site, kind: "offline", at: this.now });
      }
    }
  }

  // ---------------------------------------------------------------- inputs

  private heartbeat(e: HeartbeatEvent): void {
    const sc = this.scanners.get(e.scanner);
    if (!sc) return;
    const interval = this.cfg.heartbeatMinutes * MINUTE;
    if (sc.lastHeartbeat !== -Infinity && e.sentAt - sc.lastHeartbeat > 2.5 * interval) {
      sc.stableAfter = e.sentAt + this.cfg.reconnectSettleMinutes * MINUTE;
    }
    sc.lastHeartbeat = Math.max(sc.lastHeartbeat, e.sentAt);
    sc.offlineAlarm = false;
    if (this.opts.skew) {
      sc.offsets.push(e.at - e.sentAt);
      if (sc.offsets.length > this.cfg.skew.samples) sc.offsets.shift();
      // device time minus arrival time is the clock offset minus the network delay; delay is never negative, so
      // the largest recent value is the best estimate, and a batch of late heartbeats cannot fake a skew
      const offset = Math.max(...sc.offsets);
      sc.correction = Math.abs(offset) >= this.cfg.skew.minSeconds * 1000 ? -offset : 0;
    }
    sc.watermark = Math.max(sc.watermark, e.at + sc.correction);
    if (sc.direction === "in") {
      const site = this.sites.get(sc.site)!;
      if (site.pending.size > 0) {
        for (const p of [...site.pending].sort((a, b) => a.at - b.at || byId(a, b))) if (this.ready(p)) this.decideExit(p);
      }
    }
  }

  private read(e: ReadEvent): void {
    const sc = this.scanners.get(e.scanner);
    const site = this.sites.get(e.site);
    if (!sc || !site) return;
    const at = e.at + sc.correction;
    if (sc.correction !== 0) this.stats.skewCorrected++;
    const view: ReadView = { id: e.id, plate: e.plate, confidence: e.confidence, colour: e.colour, make: e.make, at, ...(e.cropUrl ? { cropUrl: e.cropUrl } : {}) };
    if (this.opts.health) this.watchHealth(sc, e.confidence);

    const window = this.cfg.dedupeWindowSeconds * 1000;
    // Two cars can pass one scanner seconds apart: a read joins a pass only if it is near in time and in plate.
    const same = this.cfg.samePassSeconds * 1000;
    const b = Math.floor(at / BUCKET);
    const nearby = [...(sc.buckets.get(b - 1) ?? []), ...(sc.buckets.get(b) ?? []), ...(sc.buckets.get(b + 1) ?? [])];
    const existing = nearby.find((p) =>
      p.reads.some((r) => {
        const dt = Math.abs(r.at - at);
        const d = plateDistance(r.plate, e.plate);
        return (dt <= same && d <= this.cfg.samePassMaxDistance) || (dt <= window && d <= this.cfg.match.maxDistance);
      }),
    );
    if (existing) {
      existing.reads.push(view);
      existing.lastSentAt = Math.max(existing.lastSentAt, e.sentAt);
      if (existing.direction === "in" && !existing.consumed) this.indexEntry(site, existing);
      if (existing.direction === "out" && !existing.decided) this.tasks.push(existing.lastSentAt + this.cfg.settleSeconds * 1000, { kind: "check-exit", pass: existing });
      return;
    }
    const pass: Pass = {
      id: e.id,
      scanner: sc.id,
      site: site.info.id,
      direction: e.direction,
      at,
      reads: [view],
      firstSentAt: e.sentAt,
      lastSentAt: e.sentAt,
      consumed: false,
      decided: false,
      staleChecked: false,
    };
    const list = sc.buckets.get(b);
    if (list) list.push(pass);
    else sc.buckets.set(b, [pass]);
    if (sc.buckets.size > 40_000) this.prune(sc);
    this.stats.passes++;
    if (e.direction === "in") {
      if (this.opts.quality) this.closeMissedExits(site, pass);
      this.indexEntry(site, pass);
    } else {
      this.stats.exits++;
      site.pending.add(pass);
      this.tasks.push(pass.lastSentAt + this.cfg.settleSeconds * 1000, { kind: "check-exit", pass });
      this.tasks.push(pass.firstSentAt + this.cfg.holdMaxHours * HOUR, { kind: "check-exit", pass });
    }
  }

  private payment(e: PaymentEvent): void {
    this.sites.get(e.site)?.payments.push(e);
  }

  // ---------------------------------------------------------------- passes and the open-entry index

  private spellings(p: Pass): string[] {
    const weight = new Map<string, number>();
    for (const r of p.reads) weight.set(r.plate, (weight.get(r.plate) ?? 0) + r.confidence);
    return [...weight.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
  }

  private indexEntry(site: SiteState, p: Pass): void {
    const spellings = this.spellings(p);
    site.open.add(p, spellings);
    site.openList.add(p);
    for (const s of spellings) {
      let set = site.openExact.get(s);
      if (!set) site.openExact.set(s, (set = new Set()));
      set.add(p);
    }
  }

  private consume(site: SiteState, p: Pass): void {
    p.consumed = true;
    site.open.remove(p);
    site.openList.delete(p);
    for (const s of this.spellings(p)) site.openExact.get(s)?.delete(p);
  }

  private closeMissedExits(site: SiteState, entry: Pass): void {
    const older = new Set<Pass>();
    for (const s of this.spellings(entry)) {
      for (const o of site.openExact.get(s) ?? []) if (!o.consumed && o.at < entry.at - 2 * MINUTE) older.add(o);
    }
    for (const o of [...older].sort(byId)) {
      this.consume(site, o);
      this.stats.missedExits++;
      const plate = this.bestPlate(o);
      if (!this.opts.review || !this.worthReview(site, "missed-exit", plate)) {
        this.emit({ kind: "write-off", reason: "missed-exit", ...this.ref(site, o, null, plate) });
        continue;
      }
      const item = { kind: "missed-exit" as const, id: `mx-${o.id}`, site: site.info.id, entry: this.view(o), before: entry.at };
      this.review(item, (answer) => {
        if (answer.kind !== "missed-exit" || answer.exitAt === null) {
          this.emit({ kind: "write-off", reason: "missed-exit", ...this.ref(site, o, null, plate) });
          return;
        }
        this.bill(this.session(site, o, null, plate, 1, answer.exitAt));
      });
    }
  }

  // ---------------------------------------------------------------- exits

  private ready(p: Pass): boolean {
    if (this.now < p.lastSentAt + this.cfg.settleSeconds * 1000) return false;
    if (!this.opts.watermark) return true;
    if (this.now >= p.firstSentAt + this.cfg.holdMaxHours * HOUR) return true;
    const site = this.sites.get(p.site)!;
    for (const sc of site.inScanners) {
      if (sc.watermark < p.at || this.now < sc.stableAfter) {
        return false;
      }
    }
    return true;
  }

  private decideExit(exit: Pass): void {
    if (exit.decided) return;
    exit.decided = true;
    const site = this.sites.get(exit.site)!;
    site.pending.delete(exit);
    if (this.now - exit.lastSentAt > (this.cfg.settleSeconds + 60) * 1000) this.stats.held++;

    const exitSpellings = this.spellings(exit);
    const scored = this.score(site, exit, exitSpellings);
    const best = scored.candidates[0];
    if (best && best.distance === 0) this.stats.exact++;

    if (best && best.p >= this.cfg.match.autoPosterior) {
      this.stats.auto++;
      return this.match(site, exit, best.pass, best.p);
    }
    if (scored.pNull >= this.cfg.match.autoMissedEntry) {
      this.stats.auto++;
      return this.emit({ kind: "write-off", reason: "missed-entry", ...this.ref(site, null, exit, this.bestPlate(exit)) });
    }
    if (!this.opts.review) {
      if (best && best.p >= 0.5) return this.match(site, exit, best.pass, best.p);
      return this.emit({ kind: "write-off", reason: "missed-entry", ...this.ref(site, null, exit, this.bestPlate(exit)) });
    }

    const top = scored.candidates.filter((c) => c.p >= 0.005).slice(0, 4);
    const views = top.map((c) => this.view(c.pass));
    // The model reads; code decides. Its pick must be one of ours, plausible on our own evidence, and confident.
    const verify = (answer: CropAnswer): ReviewAnswer | "suggest" => {
      const chosen = top.find((c) => c.pass.id === answer.candidate && !c.pass.consumed);
      if (chosen && chosen.p >= this.cfg.agent.minPosterior && answer.confidence >= this.cfg.agent.acceptConfidence) {
        return { kind: "orphan-exit", entry: chosen.pass.id };
      }
      if (answer.candidate === null && scored.pNull >= this.cfg.agent.missedEntryPosterior && answer.confidence >= this.cfg.agent.acceptConfidence) {
        return { kind: "orphan-exit", entry: null };
      }
      return "suggest";
    };
    const resume = (answer: ReviewAnswer) => {
      // While a person looked, another exit may have taken that entry.
      const picked = answer.kind === "orphan-exit" ? top.find((c) => c.pass.id === answer.entry && !c.pass.consumed) : undefined;
      if (picked) return this.match(site, exit, picked.pass, picked.p >= this.cfg.match.autoPosterior ? picked.p : 1);
      this.emit({ kind: "write-off", reason: "missed-entry", ...this.ref(site, null, exit, this.bestPlate(exit)) });
    };
    let suggestion: string | null = null;
    const id = `ox-${exit.id}`;
    if (this.opts.agent && top.length > 0 && this.ports.reader) {
      this.stats.agentAsked++;
      const answer = this.ports.reader.compare({ site: site.info.id, exit: this.view(exit), candidates: views });
      const verdict = verify(answer);
      if (verdict !== "suggest") {
        this.stats.agentAccepted++;
        return resume(verdict);
      }
      suggestion = top.some((c) => c.pass.id === answer.candidate) ? answer.candidate : null;
    }
    this.review({ kind: "orphan-exit", id, site: site.info.id, exit: this.view(exit), candidates: views, suggestion }, resume);
    // No reader in-process (a server asks the model asynchronously): the answer arrives through offerCropAnswer.
    const waiting = this.waiting.get(id);
    if (waiting && this.opts.agent && top.length > 0 && !this.ports.reader) waiting.verify = verify;
  }

  /**
   * A vision model's answer to a queued orphan exit, arriving later. The same check as in-process: accepted, it
   * settles the review; otherwise it stays queued for a person, with the model's pick shown as a suggestion.
   */
  offerCropAnswer(id: string, answer: CropAnswer): { result: "accepted" | "suggested" | "unknown"; resolved?: ReviewAnswer } {
    const w = this.waiting.get(id);
    if (!w || !w.verify || w.item.kind !== "orphan-exit") return { result: "unknown" };
    this.stats.agentAsked++;
    const verdict = w.verify(answer);
    if (verdict === "suggest") {
      if (w.item.candidates.some((c) => c.id === answer.candidate)) w.item = { ...w.item, suggestion: answer.candidate };
      return { result: "suggested" };
    }
    this.stats.agentAccepted++;
    this.waiting.delete(id);
    w.resume(verdict);
    return { result: "accepted", resolved: verdict };
  }

  /** Ask the reviewer; continue now if it answers now, or when a person answers through `answer()`. */
  private review(item: ReviewItem, resume: (answer: ReviewAnswer) => void): void {
    this.stats.reviews++;
    const r = this.ports.reviewer.resolve(item);
    if (r === null) {
      this.waiting.set(item.id, { item, resume, since: this.now });
      return;
    }
    this.stats.operatorMinutes += r.minutes;
    resume(r.answer);
  }

  /** A person's answer to a queued review. Returns false for an id that is not waiting (answered twice, or unknown). */
  answer(id: string, answer: ReviewAnswer, minutes = 0, at = this.now): boolean {
    const w = this.waiting.get(id);
    if (!w || w.item.kind !== answer.kind) return false;
    this.advance(at);
    this.waiting.delete(id);
    this.stats.operatorMinutes += minutes;
    w.resume(answer);
    return true;
  }

  /** Reviews waiting for a person, oldest first. */
  pendingReviews(): { item: ReviewItem; since: number }[] {
    return [...this.waiting.values()].map(({ item, since }) => ({ item, since })).sort((a, b) => a.since - b.since || (a.item.id < b.item.id ? -1 : 1));
  }

  /**
   * Each open entry is weighed by a log likelihood ratio: how much more likely is what we see if this entry is the
   * same car than if it is some other car. "No entry was read" competes with a fixed weight.
   */
  private score(site: SiteState, exit: Pass, exitSpellings: string[]) {
    const m = this.cfg.match;
    const found = site.open.query(exitSpellings).filter((p) => !p.consumed && p.at < exit.at);
    const exitColour = majority(exit.reads.map((r) => r.colour));
    const exitMake = majority(exit.reads.map((r) => r.make));
    const prior = this.cfg.stayPriors[site.kind];
    const lr = (agree: boolean, x: { sameCar: number; otherCar: number }) =>
      agree ? Math.log(x.sameCar / x.otherCar) : Math.log((1 - x.sameCar) / (1 - x.otherCar));
    const raw = found
      .map((pass) => {
        const sp = this.spellings(pass);
        let distance = Infinity;
        for (const a of exitSpellings) for (const b of sp) distance = Math.min(distance, plateDistance(a, b));
        let ll = m.coincidenceLogOdds - m.plateWeight * distance;
        if (this.opts.evidence) {
          ll += lr(majority(pass.reads.map((r) => r.colour)) === exitColour, m.colour);
          ll += lr(majority(pass.reads.map((r) => r.make)) === exitMake, m.make);
          const minutes = Math.max(1, (exit.at - pass.at) / MINUTE);
          const z = Math.abs(Math.log(minutes / prior.median)) / prior.sigma;
          ll -= 0.5 * Math.max(0, z - m.stayToleranceSigma) ** 2;
        }
        return { pass, distance, ll };
      })
      .filter((c) => c.distance <= m.maxDistance);
    const top = Math.max(m.missedEntryLogWeight, ...raw.map((c) => c.ll));
    const z = raw.reduce((s, c) => s + Math.exp(c.ll - top), 0) + Math.exp(m.missedEntryLogWeight - top);
    const candidates = raw
      .map((c) => ({ ...c, p: Math.exp(c.ll - top) / z }))
      .sort((a, b) => b.p - a.p || byId(a.pass, b.pass));
    return { candidates, pNull: Math.exp(m.missedEntryLogWeight - top) / z };
  }

  private match(site: SiteState, exit: Pass, entry: Pass, posterior: number): void {
    this.consume(site, entry);
    exit.consumed = true;
    const plate = this.bestPlate(entry, exit);
    this.bill(this.session(site, entry, exit, plate, posterior, exit.at));
  }

  /** The spelling with the most read confidence behind it, over every pass of the stay; one that breaks the plate grammar counts half. */
  private bestPlate(...passes: (Pass | null)[]): string {
    const weight = new Map<string, number>();
    for (const p of passes) {
      for (const r of p?.reads ?? []) weight.set(r.plate, (weight.get(r.plate) ?? 0) + r.confidence * (this.valid(r.plate) ? 1 : 0.5));
    }
    return [...weight.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "";
  }

  private session(site: SiteState, entry: Pass, exit: Pass | null, plate: string, posterior: number, exitAt: number): Session {
    const spellings = [...new Set([...this.spellings(entry), ...(exit ? this.spellings(exit) : [])])];
    return { id: `ses-${++this.sessionCounter}-${entry.id}`, site, entry, exit, entryAt: entry.at, exitAt, plate, spellings, posterior };
  }

  // ---------------------------------------------------------------- billing

  private bill(s: Session): void {
    const fee = feeCents(s.site.tariff, Math.max(0, s.exitAt - s.entryAt));
    if (fee === 0) return this.emit({ kind: "free", ...this.sessionRef(s) });
    const account = this.accounts.get(s.plate);
    if (account) return this.chargeAutomatic(s, account, fee);
    // Unregistered: a payment at the terminal or in the app may still arrive; decide later.
    this.tasks.push(this.now + this.cfg.noticeDelayMinutes * MINUTE, { kind: "settle-payment", session: s });
  }

  private chargeAutomatic(s: Session, account: string, fee: number): void {
    const key = `chg:${s.entry?.id ?? "-"}:${s.exit?.id ?? "-"}`;
    if (this.charged.has(key)) return;
    this.charged.add(key);
    let attempts = 0;
    while (attempts < this.cfg.billing.maxAttempts) {
      attempts++;
      const result = this.ports.psp.charge({
        account,
        amountCents: fee,
        ref: s.id,
        ...(this.opts.idempotency ? { idempotencyKey: key } : {}),
      });
      if (result === "ok") {
        if (s.exit) this.decisionDelays.push(this.now - s.exitAt);
        return this.emit({ kind: "charge", account, amountCents: fee, attempts, ...this.sessionRef(s) });
      }
    }
    this.emit({ kind: "write-off", reason: "charge-failed", ...this.sessionRef(s) });
  }

  private valid(plate: string): boolean {
    return this.formats.some((f) => f.test(plate));
  }

  /**
   * A payment request goes to the holder of one plate, so the plate must be certain: every read agrees, or exactly
   * one spelling fits the plate grammar. Otherwise an operator reads it off the image.
   */
  private certainPlate(s: Session, then: (plate: string | null) => void): void {
    const valid = s.spellings.filter((p) => this.valid(p));
    if (s.spellings.length === 1 && valid.length === 1) return then(s.spellings[0]!);
    if (valid.length === 1 && (this.accounts.has(valid[0]!) || !this.nearRegistered(valid[0]!))) return then(valid[0]!);
    if (!this.opts.quality) return then(s.plate);
    if (!this.opts.review) return then(null);
    const passes = [s.entry, s.exit].filter((p): p is Pass => p !== null).map((p) => this.view(p));
    this.review({ kind: "plate", id: `pl-${s.id}`, site: s.site.info.id, passes, spellings: s.spellings }, (answer) =>
      then(answer.kind === "plate" ? answer.plate : null),
    );
  }

  private nearRegistered(plate: string): boolean {
    for (const r of this.registeredIndex.query([plate])) if (plateDistance(r, plate) <= this.cfg.notice.lookalikeDistance) return true;
    return false;
  }

  private settleUnregistered(s: Session): void {
    const fee = feeCents(s.site.tariff, Math.max(0, s.exitAt - s.entryAt));
    const grace = this.cfg.payments.graceMinutes * MINUTE;
    const pool = s.site.payments.filter((p) => p.at >= s.entryAt - 5 * MINUTE && p.at <= s.exitAt + grace);
    const exact = pool.find((p) => s.spellings.includes(p.plate));
    if (exact) return this.linkPayment(s, exact);
    if (this.opts.quality) {
      const near = pool
        .map((p) => ({ p, d: Math.min(...s.spellings.map((x) => plateDistance(x, p.plate))) }))
        .filter((x) => x.d <= this.cfg.payments.maxDistance);
      // The terminal priced the stay it showed the driver: an amount that fits this stay is strong evidence.
      const fits = near.filter((x) => x.p.amountCents === feeCents(s.site.tariff, Math.max(0, x.p.at - s.entryAt)));
      if (fits.length === 1) return this.linkPayment(s, fits[0]!.p);
      if (near.length > 0 && s.entry && s.exit) {
        const item = {
          kind: "payment" as const,
          id: `pm-${s.id}`,
          site: s.site.info.id,
          exit: this.view(s.exit),
          entry: this.view(s.entry),
          candidates: near.map((x) => ({ id: x.p.id, plate: x.p.plate, at: x.p.at })).sort(byId),
        };
        if (this.opts.review) {
          return this.review(item, (answer) => {
            const picked = answer.kind === "payment" ? near.find((x) => x.p.id === answer.payment && s.site.payments.includes(x.p)) : undefined;
            if (picked) return this.linkPayment(s, picked.p);
            this.requestPayment(s, fee);
          });
        }
      }
    }
    this.requestPayment(s, fee);
  }

  /** No payment found: a notice to the holder, if the stay and the plate are certain enough to put in a letter. */
  private requestPayment(s: Session, fee: number): void {
    if (fee < this.cfg.notice.minFeeCents || s.posterior < this.cfg.notice.minPosterior) {
      return this.emit({ kind: "write-off", reason: "low-confidence", ...this.sessionRef(s) });
    }
    this.certainPlate(s, (plate) => {
      if (plate === null) return this.emit({ kind: "write-off", reason: "low-confidence", ...this.sessionRef(s) });
      const account = this.accounts.get(plate);
      if (account) return this.chargeAutomatic({ ...s, plate }, account, fee);
      this.emit({ kind: "notice", amountCents: fee, ...this.sessionRef({ ...s, plate }) });
    });
  }

  private linkPayment(s: Session, p: PaymentEvent): void {
    const list = s.site.payments;
    const i = list.indexOf(p);
    if (i >= 0) list.splice(i, 1);
    this.emit({ kind: "paid", payment: p.id, ...this.sessionRef(s) });
  }

  // ---------------------------------------------------------------- scanner health

  private watchHealth(sc: ScannerState, confidence: number): void {
    const h = this.cfg.health;
    const x = confidence < h.lowConfidence ? 1 : 0;
    sc.cusum = Math.max(0, sc.cusum + x - h.baseline - h.slack);
    if (!sc.degradedAlarm && sc.cusum >= h.threshold) {
      sc.degradedAlarm = true;
      this.alarms.push({ scanner: sc.id, site: sc.site, kind: "degraded", at: this.now });
    }
  }

  // ---------------------------------------------------------------- output

  private view(p: Pass): PassView {
    return { id: p.id, scanner: p.scanner, reads: [...p.reads].sort((a, b) => b.confidence - a.confidence || byId(a, b)) };
  }

  private ref(site: SiteState, entry: Pass | null, exit: Pass | null, plate: string): SessionRef {
    return {
      session: `ses-${++this.sessionCounter}-${(exit ?? entry)!.id}`,
      site: site.info.id,
      plate,
      entryReads: entry ? entry.reads.map((r) => r.id) : [],
      exitReads: exit ? exit.reads.map((r) => r.id) : [],
      entryAt: entry?.at ?? null,
      exitAt: exit?.at ?? null,
      decidedAt: this.now,
    };
  }

  private sessionRef(s: Session): SessionRef {
    return {
      session: s.id,
      site: s.site.info.id,
      plate: s.plate,
      entryReads: s.entry ? s.entry.reads.map((r) => r.id) : [],
      exitReads: s.exit ? s.exit.reads.map((r) => r.id) : [],
      entryAt: s.entryAt,
      exitAt: s.exitAt,
      decidedAt: this.now,
    };
  }

  private emit(o: Outcome): void {
    this.outcomes.push(o);
  }
}

function majority(values: string[]): string {
  const c = new Map<string, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  let best = "";
  let n = -1;
  for (const [k, v] of [...c.entries()].sort()) if (v > n) [best, n] = [k, v];
  return best;
}
