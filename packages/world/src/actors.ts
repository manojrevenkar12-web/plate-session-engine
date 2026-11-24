import {
  type ChargeRequest,
  type ChargeResult,
  type CropAnswer,
  type CropQuestion,
  type CropReader,
  type PassView,
  type PaymentProvider,
  type ReviewAnswer,
  type ReviewItem,
  type Reviewer,
  plateDistance,
  rng,
} from "@pse/domain";
import type { World } from "./world.js";

/** The truth behind a pass: the visit its reads came from. A pass mixing visits takes the majority. */
export function visitOf(world: World, pass: PassView): string | null {
  const count = new Map<string, number>();
  for (const r of pass.reads) {
    const v = world.truth.visitByRead.get(r.id);
    if (v) count.set(v.visit, (count.get(v.visit) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of [...count.entries()].sort()) if (c > n) [best, n] = [k, c];
  return best;
}

/** The payment provider: sometimes times out, and sometimes it had already taken the money when it did. */
export class SimulatedPsp implements PaymentProvider {
  readonly ledger: { account: string; amountCents: number; ref: string; key: string | null }[] = [];
  private readonly seen = new Set<string>();
  private readonly attempts = new Map<string, number>();

  constructor(private readonly world: World) {}

  charge(req: ChargeRequest): ChargeResult {
    if (req.idempotencyKey && this.seen.has(req.idempotencyKey)) return "ok";
    const attempt = (this.attempts.get(req.ref) ?? 0) + 1;
    this.attempts.set(req.ref, attempt);
    const r = rng(this.world.seed, `${this.world.name}:psp`, `${req.ref}:${attempt}`);
    const commit = () => {
      this.ledger.push({ account: req.account, amountCents: req.amountCents, ref: req.ref, key: req.idempotencyKey ?? null });
      if (req.idempotencyKey) this.seen.add(req.idempotencyKey);
    };
    if (r.chance(this.world.config.psp.timeoutRate)) {
      if (r.chance(this.world.config.psp.committedOnTimeout)) commit();
      return "timeout";
    }
    commit();
    return "ok";
  }
}

/** An operator who looks at the camera images. Right almost always, slow, and inclined to accept a suggestion. */
export class SimulatedOperator implements Reviewer {
  minutes = 0;
  items = 0;

  constructor(private readonly world: World) {}

  resolve(item: ReviewItem): { answer: ReviewAnswer; minutes: number } {
    const cfg = this.world.config.operator;
    const r = rng(this.world.seed, `${this.world.name}:operator`, item.id);
    this.items++;
    let answer: ReviewAnswer;
    let minutes: number;
    if (item.kind === "orphan-exit") {
      const truth = visitOf(this.world, item.exit);
      const right = item.candidates.find((c) => visitOf(this.world, c) === truth)?.id ?? null;
      if (item.suggestion !== null) {
        const suggestionRight = item.suggestion === right;
        if (suggestionRight || r.chance(cfg.automationBias)) {
          answer = { kind: "orphan-exit", entry: item.suggestion };
          minutes = cfg.minutes.suggested;
        } else {
          answer = { kind: "orphan-exit", entry: right };
          minutes = cfg.minutes.plain;
        }
      } else {
        let entry = right;
        if (r.chance(cfg.error) && item.candidates.length > 0) entry = r.pick(item.candidates).id;
        answer = { kind: "orphan-exit", entry };
        minutes = cfg.minutes.plain;
      }
    } else if (item.kind === "missed-exit") {
      const v = this.world.truth.visitById.get(visitOf(this.world, item.entry) ?? "");
      const found = v && v.exited && v.exitAt <= item.before && r.chance(cfg.findsExit);
      answer = { kind: "missed-exit", exitAt: found ? v.exitAt : null };
      minutes = cfg.minutes.missedExit;
    } else if (item.kind === "plate") {
      const v = this.world.truth.visitById.get(visitOf(this.world, { id: item.id, scanner: "", reads: item.passes.flatMap((p) => p.reads) }) ?? "");
      answer = { kind: "plate", plate: v && !r.chance(cfg.error) ? v.plate : null };
      minutes = cfg.minutes.plate;
    } else {
      const v = this.world.truth.visitById.get(visitOf(this.world, item.exit) ?? "");
      const right = item.candidates.find((c) => c.id === v?.paymentId)?.id ?? null;
      answer = { kind: "payment", payment: r.chance(cfg.error) ? null : right };
      minutes = cfg.minutes.payment;
    }
    this.minutes += minutes;
    return { answer, minutes };
  }
}

/**
 * A vision model comparing plate crops. Usually right; fooled by lookalike cars; when the right car is not among
 * the candidates it sometimes picks the closest one anyway.
 */
export class SimulatedCropReader implements CropReader {
  calls = 0;

  constructor(private readonly world: World) {}

  compare(q: CropQuestion): CropAnswer {
    this.calls++;
    const cfg = this.world.config.reader;
    const r = rng(this.world.seed, `${this.world.name}:reader`, q.exit.id);
    const truth = visitOf(this.world, q.exit);
    const right = q.candidates.find((c) => visitOf(this.world, c) === truth)?.id ?? null;
    const exitRead = q.exit.reads[0]!;
    const closest = [...q.candidates]
      .filter((c) => c.id !== right)
      .sort((a, b) => plateDistance(a.reads[0]!.plate, exitRead.plate) - plateDistance(b.reads[0]!.plate, exitRead.plate) || (a.id < b.id ? -1 : 1))[0];
    if (right === null) {
      if (closest && r.chance(cfg.hallucinate)) return { candidate: closest.id, confidence: round(r.between(0.7, 0.97)) };
      return { candidate: null, confidence: round(r.between(0.8, 0.99)) };
    }
    const lookalike =
      closest !== undefined &&
      closest.reads[0]!.colour === exitRead.colour &&
      closest.reads[0]!.make === exitRead.make &&
      plateDistance(closest.reads[0]!.plate, exitRead.plate) < 1;
    const errorP = lookalike ? cfg.lookalikeError : 1 - cfg.accuracy;
    if (r.chance(errorP)) {
      const wrong = closest ?? null;
      return { candidate: wrong ? wrong.id : null, confidence: round(r.between(0.6, 0.97)) };
    }
    return { candidate: right, confidence: round(r.between(0.85, 0.995)) };
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
