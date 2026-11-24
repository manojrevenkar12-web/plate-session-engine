import {
  type Account,
  type Direction,
  type EdgeEvent,
  type HeartbeatEvent,
  type PaymentEvent,
  type ReadEvent,
  type SiteInfo,
  type SiteKind,
  DAY,
  feeCents,
  HOUR,
  MINUTE,
  rng,
} from "@pse/domain";
import type { WorldConfig } from "./config.js";
import { makeFleet, makePlate, misread, typo } from "./plates.js";

/** One car's stay. The truth: what really happened, which no product package may see. */
export interface Visit {
  id: string;
  site: string;
  plate: string;
  colour: string;
  make: string;
  entryAt: number;
  exitAt: number;
  /** false while the car is still parked when the window ends: not scored */
  exited: boolean;
  automatic: boolean;
  account: string | null;
  /** paid at a terminal or in the app before leaving */
  paid: boolean;
  paymentId: string | null;
  paidAt: number | null;
  dueCents: number;
  /** if a correct payment notice goes out, does the holder pay it */
  noticePays: boolean;
  entryReads: string[];
  exitReads: string[];
}

export interface ScannerTruth {
  id: string;
  site: string;
  direction: Direction;
  lane: number;
  offline: { from: number; to: number }[];
  skewMs: number;
  degradationStart: number | null;
}

export interface World {
  name: string;
  seed: number;
  config: WorldConfig;
  start: number;
  end: number;
  /** product data: what is installed, who registered for Automatic Payment */
  sites: SiteInfo[];
  accounts: Account[];
  /** what the cloud receives, in arrival order, duplicates included */
  events: EdgeEvent[];
  truth: {
    visits: Visit[];
    visitByRead: Map<string, { visit: string; direction: Direction }>;
    visitById: Map<string, Visit>;
    scanners: ScannerTruth[];
  };
}

const KINDS: SiteKind[] = ["shopping", "office", "residential", "hospital", "airport", "leisure"];

export function simulate(config: WorldConfig, seed: number): World {
  const start = Date.parse(config.start);
  const end = start + config.days * DAY;
  const purpose = (p: string) => `${config.name}:${p}`;

  // ---- sites and scanners
  const sites: SiteInfo[] = [];
  const scanners: ScannerTruth[] = [];
  for (let i = 0; i < config.sites.count; i++) {
    const r = rng(seed, purpose("site"), i);
    const kind = r.weighted(config.sites.mix);
    const id = `site-${String(i + 1).padStart(3, "0")}`;
    const lanes = r.pick(config.sites.lanes);
    const info: SiteInfo = { id, kind, tariff: kind, scanners: [] };
    for (let lane = 1; lane <= lanes; lane++) {
      for (const direction of ["in", "out"] as const) {
        const sid = `${id}-L${lane}-${direction}`;
        info.scanners.push({ id: sid, direction, lane });
        scanners.push(scannerTruth(config, seed, sid, id, direction, lane, start));
      }
    }
    sites.push(info);
  }
  const scannerById = new Map(scanners.map((s) => [s.id, s]));

  // ---- vehicles
  const used = new Set<string>();
  const vehicle = (key: string, plate?: string) => {
    const r = rng(seed, purpose("vehicle"), key);
    let p = plate ?? makePlate(r, config.region, config.plates.codes);
    while (used.has(p) && !plate) p = makePlate(r, config.region, config.plates.codes);
    used.add(p);
    return { plate: p, colour: r.weighted(config.colours), make: r.weighted(config.makes) };
  };
  type Vehicle = ReturnType<typeof vehicle> & { automatic: boolean; account: string | null };
  const accounts: Account[] = [];
  const withAccount = (v: ReturnType<typeof vehicle>, key: string, share: number): Vehicle => {
    const automatic = rng(seed, purpose("account"), key).chance(share);
    const account = automatic ? `acct-${accounts.length + 1}` : null;
    if (account) accounts.push({ id: account, plate: v.plate });
    return { ...v, automatic, account };
  };

  const regulars = new Map<string, Vehicle[]>();
  for (const site of sites) {
    const r = rng(seed, purpose("regulars"), site.id);
    const n = r.int(config.regularsPerSite[0], config.regularsPerSite[1]);
    const list: Vehicle[] = [];
    if (config.fleets.kinds.includes(site.kind) && r.chance(config.fleets.share)) {
      const size = r.int(config.fleets.size[0], config.fleets.size[1]);
      for (const plate of makeFleet(r, config.region, config.plates.codes, size)) {
        if (used.has(plate)) continue;
        const v = vehicle(`${site.id}:fleet:${plate}`, plate);
        // fleet cars are often the same model and colour
        const fr = rng(seed, purpose("fleet-look"), site.id);
        list.push(withAccount({ ...v, colour: fr.weighted(config.colours), make: fr.weighted(config.makes) }, `${site.id}:${plate}`, config.automaticShare * 1.5));
      }
    }
    for (let k = list.length; k < n; k++) list.push(withAccount(vehicle(`${site.id}:reg:${k}`), `${site.id}:reg:${k}`, config.automaticShare));
    regulars.set(site.id, list);
  }

  // ---- visits
  const visits: Visit[] = [];
  for (const site of sites) {
    const kind = site.kind;
    const tariff = config.tariffs[kind];
    const regs = regulars.get(site.id)!;
    for (let day = 0; day < config.days; day++) {
      const r = rng(seed, purpose("day"), `${site.id}:${day}`);
      const n = r.int(config.visitsPerDay[kind][0], config.visitsPerDay[kind][1]);
      const weights = Object.fromEntries(config.arrivals[kind].map((w, h) => [String(h).padStart(2, "0"), w]));
      const regularToday = new Set<number>();
      for (let k = 0; k < n; k++) {
        const vr = rng(seed, purpose("visit"), `${site.id}:${day}:${k}`);
        const id = `v-${site.id}-${day}-${k}`;
        const hour = Number(vr.weighted(weights));
        const entryAt = start + day * DAY + hour * HOUR + Math.floor(vr.next() * HOUR);
        const stay = Math.max(3, vr.logNormal(config.stayMinutes[kind].median, config.stayMinutes[kind].sigma));
        const exitAt = entryAt + Math.round(stay * MINUTE);
        let v: Vehicle;
        if (vr.chance(config.regularShare) && regs.length > 0) {
          let idx = vr.int(0, regs.length - 1);
          let guard = 0;
          while (regularToday.has(idx) && guard++ < 20) idx = vr.int(0, regs.length - 1);
          regularToday.add(idx);
          v = regs[idx]!;
        } else {
          v = withAccount(vehicle(id), id, config.automaticShare * 0.5);
        }
        const exited = exitAt < end;
        const payR = rng(seed, purpose("pay"), id);
        let paid = false;
        let paymentId: string | null = null;
        if (!v.automatic && feeCents(tariff, exitAt - entryAt) > 0 && exited && payR.chance(config.payBeforeExitShare)) {
          paid = true;
          paymentId = `pay-${id}`;
        }
        const payAt = paid ? exitAt - Math.round(payR.between(2, 14) * MINUTE) : 0;
        visits.push({
          id,
          site: site.id,
          plate: v.plate,
          colour: v.colour,
          make: v.make,
          entryAt,
          exitAt,
          exited,
          automatic: v.automatic,
          account: v.account,
          paid,
          paymentId,
          paidAt: paid ? payAt : null,
          dueCents: 0,
          noticePays: payR.chance(config.noticePayRate),
          entryReads: [],
          exitReads: [],
        });
      }
    }
  }
  visits.sort((a, b) => a.entryAt - b.entryAt || (a.id < b.id ? -1 : 1));

  // A vehicle cannot be in two places at once: drop a regular's visit that overlaps its previous stay.
  const busy = new Map<string, number>();
  const kept: Visit[] = [];
  for (const v of visits) {
    if ((busy.get(v.plate) ?? -Infinity) > v.entryAt - 5 * MINUTE) continue;
    busy.set(v.plate, v.exitAt);
    kept.push(v);
  }

  // ---- lanes, and the headway two cars need at one lane
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const lanePasses = new Map<string, { v: Visit; dir: Direction }[]>();
  const laneOf = new Map<string, string>();
  for (const v of kept) {
    const site = siteById.get(v.site)!;
    const lanes = Math.max(...site.scanners.map((s) => s.lane));
    const lr = rng(seed, purpose("lane"), v.id);
    for (const dir of v.exited ? (["in", "out"] as const) : (["in"] as const)) {
      const sc = `${site.id}-L${lr.int(1, lanes)}-${dir}`;
      laneOf.set(`${v.id}:${dir}`, sc);
      lanePasses.set(sc, [...(lanePasses.get(sc) ?? []), { v, dir }]);
    }
  }
  const headway = config.scanner.headwaySeconds * 1000;
  for (const sc of [...lanePasses.keys()].sort()) {
    const list = lanePasses.get(sc)!.sort((a, b) => passAt(a) - passAt(b) || (a.v.id < b.v.id ? -1 : 1));
    let last = -Infinity;
    for (const x of list) {
      const t = Math.max(passAt(x), last + headway);
      if (x.dir === "in") {
        const shift = t - x.v.entryAt;
        x.v.entryAt = t;
        if (x.v.exitAt - x.v.entryAt < MINUTE) x.v.exitAt += shift;
      } else x.v.exitAt = t;
      last = t;
    }
  }
  for (const v of kept) {
    const tariff = config.tariffs[siteById.get(v.site)!.kind];
    if (v.paid && v.paidAt !== null) v.paidAt = Math.min(Math.max(v.paidAt, v.entryAt + MINUTE), v.exitAt - MINUTE);
    // A terminal that shows €0 takes no payment; that driver owes the full stay at the exit.
    if (v.paid && feeCents(tariff, Math.max(0, v.paidAt! - v.entryAt)) === 0) {
      v.paid = false;
      v.paymentId = null;
      v.paidAt = null;
    }
    v.dueCents = feeCents(tariff, Math.max(0, (v.paid ? v.paidAt! : v.exitAt) - v.entryAt));
  }

  // ---- reads
  const events: EdgeEvent[] = [];
  const visitByRead = new Map<string, { visit: string; direction: Direction }>();
  const deliver = (e: EdgeEvent, sc: ScannerTruth | null, trueAt: number, key: string) => {
    const r = rng(seed, purpose("deliver"), key);
    const off = sc?.offline.find((w) => trueAt >= w.from && trueAt < w.to);
    e.sentAt = off
      ? off.to + Math.round(r.between(config.delivery.flushSeconds[0], config.delivery.flushSeconds[1]) * 1000)
      : trueAt + Math.round(r.between(config.delivery.latencySeconds[0], config.delivery.latencySeconds[1]) * 1000);
    events.push(e);
    if (r.chance(config.delivery.redeliveryRate)) events.push({ ...e, sentAt: e.sentAt + Math.round(r.between(1, 600) * 1000) });
  };

  for (const v of kept) {
    const site = siteById.get(v.site)!;
    const passes: { dir: Direction; at: number }[] = [{ dir: "in", at: v.entryAt }];
    if (v.exited) passes.push({ dir: "out", at: v.exitAt });
    for (const pass of passes) {
      const sc = scannerById.get(laneOf.get(`${v.id}:${pass.dir}`)!)!;
      const pr = rng(seed, purpose("pass"), `${v.id}:${pass.dir}`);
      const degr = degradation(sc, pass.at, config.scanner.degradationRampHours);
      const miss = config.scanner.missRate + degr * config.scanner.degradedMiss;
      if (pr.chance(miss)) continue;
      const wrongP = config.scanner.misreadRate + degr * (config.scanner.degradedMisread - config.scanner.misreadRate);
      const copies = pr.chance(config.scanner.duplicateRate) ? pr.int(2, 3) : 1;
      for (let c = 0; c < copies; c++) {
        const rr = rng(seed, purpose("read"), `${v.id}:${pass.dir}:${c}`);
        let plate = v.plate;
        let right = true;
        if (rr.chance(wrongP)) {
          plate = misread(rr, plate, config.scanner.dropCharShare);
          if (rr.chance(config.scanner.secondErrorShare)) plate = misread(rr, plate, 0);
          right = plate === v.plate;
        }
        const band = right ? config.scanner.confidence.right : config.scanner.confidence.wrong;
        const confidence = Math.round(Math.min(0.999, rr.between(band[0], band[1]) - degr * 0.08) * 1000) / 1000;
        const colour = rr.chance(config.scanner.colourError) ? rr.weighted(config.colours) : v.colour;
        const make = rr.chance(config.scanner.makeError) ? rr.weighted(config.makes) : v.make;
        const trueAt = pass.at + (c === 0 ? 0 : Math.round(rr.between(200, config.scanner.duplicateSpreadSeconds * 1000)));
        const id = `r-${v.id}-${pass.dir}-${c}`;
        const e: ReadEvent = {
          kind: "read",
          id,
          scanner: sc.id,
          site: site.id,
          direction: pass.dir,
          at: trueAt + sc.skewMs,
          plate,
          confidence,
          colour,
          make,
          sentAt: 0,
        };
        visitByRead.set(id, { visit: v.id, direction: pass.dir });
        (pass.dir === "in" ? v.entryReads : v.exitReads).push(id);
        deliver(e, sc, trueAt, id);
      }
    }
    if (v.paid) {
      const pr = rng(seed, purpose("payment"), v.id);
      const at = v.paidAt!;
      const e: PaymentEvent = {
        kind: "payment",
        id: v.paymentId!,
        site: v.site,
        plate: pr.chance(config.typoRate) ? typo(pr, v.plate) : v.plate,
        at,
        amountCents: v.dueCents,
        channel: pr.chance(config.appShare) ? "app" : "terminal",
        sentAt: 0,
      };
      deliver(e, null, at, e.id);
    }
  }

  // ---- heartbeats
  const step = config.scanner.heartbeatMinutes * MINUTE;
  for (const sc of scanners) {
    for (let t = start; t < end; t += step) {
      if (sc.offline.some((w) => t >= w.from && t < w.to)) continue;
      const e: HeartbeatEvent = { kind: "heartbeat", id: `hb-${sc.id}-${t}`, scanner: sc.id, site: sc.site, at: t + sc.skewMs, sentAt: 0 };
      const r = rng(seed, purpose("hb"), e.id);
      e.sentAt = t + Math.round(r.between(config.delivery.latencySeconds[0], config.delivery.latencySeconds[1]) * 1000);
      events.push(e);
    }
  }

  events.sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const inWindow = events.filter((e) => e.sentAt < end + 2 * HOUR);

  return {
    name: config.name,
    seed,
    config,
    start,
    end,
    sites,
    accounts,
    events: inWindow,
    truth: { visits: kept, visitByRead, visitById: new Map(kept.map((v) => [v.id, v])), scanners },
  };
}

function passAt(x: { v: Visit; dir: Direction }): number {
  return x.dir === "in" ? x.v.entryAt : x.v.exitAt;
}

function scannerTruth(
  config: WorldConfig,
  seed: number,
  id: string,
  site: string,
  direction: Direction,
  lane: number,
  start: number,
): ScannerTruth {
  const r = rng(seed, `${config.name}:scanner`, id);
  const offline: { from: number; to: number }[] = [];
  for (let d = 0; d < config.days; d++) {
    if (!r.chance(config.scanner.offlinePerScannerPerDay)) continue;
    const from = start + d * DAY + Math.floor(r.next() * DAY);
    const [lo, hi] = config.scanner.offlineHours;
    const hours = Math.exp(r.between(Math.log(lo), Math.log(hi)));
    offline.push({ from, to: from + Math.round(hours * HOUR) });
  }
  const skewMs = r.chance(config.scanner.skewShare)
    ? Math.round((r.chance(0.5) ? 1 : -1) * r.between(config.scanner.skewMinutes[0], config.scanner.skewMinutes[1]) * MINUTE)
    : 0;
  let degradationStart: number | null = null;
  for (let d = 0; d < config.days && degradationStart === null; d++) {
    if (r.chance(config.scanner.degradationPerScannerPerDay)) degradationStart = start + d * DAY + Math.floor(r.next() * DAY);
  }
  return { id, site, direction, lane, offline, skewMs, degradationStart };
}

/** 0 when clean, rising to 1 over the ramp: a lens getting dirty, a camera knocked out of line. */
export function degradation(sc: ScannerTruth, at: number, rampHours: number): number {
  if (sc.degradationStart === null || at < sc.degradationStart) return 0;
  return Math.min(1, (at - sc.degradationStart) / (rampHours * HOUR));
}

export const SITE_KINDS = KINDS;
