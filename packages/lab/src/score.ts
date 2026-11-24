import { HOUR, MINUTE } from "@pse/domain";
import type { Alarm, Outcome } from "@pse/engine";
import type { SimulatedPsp, Visit, World } from "@pse/world";

export interface Score {
  visits: number;
  toCollectCents: number;
  /** what a desk that never errs would collect: every automatic stay, and the notices holders pay */
  collectibleCents: number;
  capturedCents: number;
  revenueCaptured: number;
  wrongCharges: number;
  wrongNotices: number;
  noticesToPayers: number;
  wrongPer10k: number;
  doubleCharges: number;
  overchargedCents: number;
  lostCents: number;
  operatorMinutes: number;
  operatorMinutesPer1k: number;
  reviews: number;
  modelCalls: number;
  agentAccepted: number;
  degradedScanners: number;
  degradedFlagged: number;
  flagLeadHours: number | null;
  falseDegradedAlarms: number;
  chargedWithin15: number;
  rightCharges: number;
  quickCharges: number;
  flagged: number;
  leadHours: number[];
}

/** Truth behind a list of read ids: the visit most of them came from. */
function visitOf(world: World, reads: string[]): Visit | null {
  const count = new Map<string, number>();
  for (const r of reads) {
    const v = world.truth.visitByRead.get(r);
    if (v) count.set(v.visit, (count.get(v.visit) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of [...count.entries()].sort()) if (c > n) [best, n] = [k, c];
  return best ? world.truth.visitById.get(best) ?? null : null;
}

export function score(
  world: World,
  outcomes: Outcome[],
  psp: SimulatedPsp,
  extra: { operatorMinutes: number; reviews: number; modelCalls: number; agentAccepted: number; alarms: Alarm[] },
): Score {
  const accountPlate = new Map(world.accounts.map((a) => [a.id, a.plate]));
  const exited = world.truth.visits.filter((v) => v.exited);
  const toCollect = exited.filter((v) => v.dueCents > 0 && (v.automatic || !v.paid));
  const toCollectCents = toCollect.reduce((s, v) => s + v.dueCents, 0);
  const collectibleCents = toCollect.reduce((s, v) => s + (v.automatic || v.noticePays ? v.dueCents : 0), 0);

  const collected = new Map<string, number>();
  let wrongCharges = 0;
  let wrongNotices = 0;
  let noticesToPayers = 0;
  let doubles = 0;
  let overcharged = 0;
  let quick = 0;
  let rightCharges = 0;
  for (const o of outcomes) {
    if (o.kind !== "charge" && o.kind !== "notice") continue;
    const v = visitOf(world, o.exitReads.length > 0 ? o.exitReads : o.entryReads);
    if (o.kind === "charge") {
      const right = v !== null && accountPlate.get(o.account) === v.plate && o.amountCents <= v.dueCents;
      if (!right) {
        wrongCharges++;
        if (v && accountPlate.get(o.account) === v.plate) overcharged += o.amountCents - v.dueCents;
        continue;
      }
      if (collected.has(v.id)) {
        doubles++;
        continue;
      }
      collected.set(v.id, o.amountCents);
      rightCharges++;
      if (o.decidedAt - v.exitAt <= 15 * MINUTE) quick++;
    } else {
      const right = v !== null && o.plate === v.plate && !v.paid && !v.automatic && o.amountCents <= v.dueCents;
      if (!right) {
        wrongNotices++;
        if (v && v.paid && o.plate === v.plate) noticesToPayers++;
        continue;
      }
      if (collected.has(v.id)) {
        doubles++;
        continue;
      }
      collected.set(v.id, v.noticePays ? o.amountCents : 0);
    }
  }
  const perRef = new Map<string, number>();
  for (const c of psp.ledger) perRef.set(c.ref, (perRef.get(c.ref) ?? 0) + 1);
  for (const n of perRef.values()) if (n > 1) doubles += n - 1;

  const captured = [...collected.values()].reduce((s, x) => s + x, 0);

  const degraded = world.truth.scanners.filter((s) => s.degradationStart !== null && s.degradationStart < world.end - 6 * HOUR);
  const leads: number[] = [];
  let falseAlarms = 0;
  for (const a of extra.alarms) {
    if (a.kind !== "degraded") continue;
    const sc = world.truth.scanners.find((s) => s.id === a.scanner);
    if (!sc || sc.degradationStart === null || a.at < sc.degradationStart) falseAlarms++;
  }
  for (const sc of degraded) {
    const a = extra.alarms.find((x) => x.kind === "degraded" && x.scanner === sc.id && x.at >= sc.degradationStart!);
    if (a) leads.push((a.at - sc.degradationStart!) / HOUR);
  }
  leads.sort((a, b) => a - b);

  return {
    visits: exited.length,
    toCollectCents,
    collectibleCents,
    capturedCents: captured,
    revenueCaptured: collectibleCents > 0 ? captured / collectibleCents : 1,
    wrongCharges,
    wrongNotices,
    noticesToPayers,
    wrongPer10k: ((wrongCharges + wrongNotices) / exited.length) * 10_000,
    doubleCharges: doubles,
    overchargedCents: overcharged,
    lostCents: collectibleCents - captured,
    operatorMinutes: extra.operatorMinutes,
    operatorMinutesPer1k: (extra.operatorMinutes / exited.length) * 1000,
    reviews: extra.reviews,
    modelCalls: extra.modelCalls,
    agentAccepted: extra.agentAccepted,
    degradedScanners: degraded.length,
    degradedFlagged: degraded.length > 0 ? leads.length / degraded.length : 1,
    flagLeadHours: leads.length > 0 ? leads[Math.floor(leads.length / 2)]! : null,
    falseDegradedAlarms: falseAlarms,
    chargedWithin15: rightCharges > 0 ? quick / rightCharges : 0,
    rightCharges,
    quickCharges: quick,
    flagged: leads.length,
    leadHours: leads.map((x) => Math.round(x * 100) / 100),
  };
}
