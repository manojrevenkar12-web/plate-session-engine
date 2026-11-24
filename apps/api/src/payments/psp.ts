import type { ChargeRequest, ChargeResult, PaymentProvider } from "@pse/domain";

/**
 * The engine decides synchronously; the payment provider is a network away. So the engine's port only writes the
 * request to an outbox, and a worker calls the provider with the same idempotency key until it answers.
 */
export class OutboxPsp implements PaymentProvider {
  private pending: ChargeRequest[] = [];

  charge(req: ChargeRequest): ChargeResult {
    if (!req.idempotencyKey) throw new Error("the outbox refuses a charge without an idempotency key");
    this.pending.push(req);
    return "ok";
  }

  drain(): ChargeRequest[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}

/** What the worker calls. */
export interface PspClient {
  charge(req: { account: string; amountCents: number; ref: string; idempotencyKey: string }): Promise<"ok" | "declined">;
}

/** A provider that accepts everything once per key; for development and tests. */
export class SandboxPsp implements PspClient {
  readonly taken = new Map<string, { account: string; amountCents: number }>();

  async charge(req: { account: string; amountCents: number; ref: string; idempotencyKey: string }): Promise<"ok"> {
    if (!this.taken.has(req.idempotencyKey)) this.taken.set(req.idempotencyKey, { account: req.account, amountCents: req.amountCents });
    return "ok";
  }
}

/** A provider over HTTP that honours an Idempotency-Key header, as Stripe and Adyen do. */
export class HttpPsp implements PspClient {
  constructor(private readonly url: string) {}

  async charge(req: { account: string; amountCents: number; ref: string; idempotencyKey: string }): Promise<"ok" | "declined"> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": req.idempotencyKey },
      body: JSON.stringify({ account: req.account, amount: req.amountCents, currency: "EUR", reference: req.ref }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 402) return "declined";
    if (!res.ok) throw new Error(`payment provider answered ${res.status}`);
    return "ok";
  }
}
