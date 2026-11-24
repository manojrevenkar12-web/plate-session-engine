/**
 * The seams between the platform and the outside world: the payment provider, the operator's review screen and a
 * vision model that compares plate crops. The lab plugs simulated actors in here; production plugs real ones.
 */

export interface ChargeRequest {
  account: string;
  amountCents: number;
  /** what is being paid for (the session); shows on the statement */
  ref: string;
  /** the provider refuses a second charge with a key it has seen */
  idempotencyKey?: string;
}

export type ChargeResult = "ok" | "timeout";

export interface PaymentProvider {
  charge(req: ChargeRequest): ChargeResult;
}

/** A read as a reviewer or a model sees it: the plate the scanner wrote, its confidence and the car around it. */
export interface ReadView {
  id: string;
  plate: string;
  confidence: number;
  colour: string;
  make: string;
  at: number;
  cropUrl?: string;
}

export interface PassView {
  id: string;
  scanner: string;
  reads: ReadView[];
}

export type ReviewItem =
  | { kind: "orphan-exit"; id: string; site: string; exit: PassView; candidates: PassView[]; suggestion: string | null }
  | { kind: "missed-exit"; id: string; site: string; entry: PassView; before: number }
  | { kind: "payment"; id: string; site: string; exit: PassView; entry: PassView; candidates: { id: string; plate: string; at: number }[] }
  | { kind: "plate"; id: string; site: string; passes: PassView[]; spellings: string[] };

export type ReviewAnswer =
  | { kind: "orphan-exit"; entry: string | null }
  | { kind: "missed-exit"; exitAt: number | null }
  | { kind: "payment"; payment: string | null }
  | { kind: "plate"; plate: string | null };

/** Answers a review now, or returns null to say a person will answer later (the engine then waits for it). */
export interface Reviewer {
  resolve(item: ReviewItem): { answer: ReviewAnswer; minutes: number } | null;
}

/** "Is the car on these exit crops the same as on one of these entry crops?" */
export interface CropQuestion {
  site: string;
  exit: PassView;
  candidates: PassView[];
}

export interface CropAnswer {
  candidate: string | null;
  confidence: number;
}

export interface CropReader {
  compare(q: CropQuestion): CropAnswer;
}
