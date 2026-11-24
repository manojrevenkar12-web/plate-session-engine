# Runbook

Who owns what once the engine runs, what is promised, and what to do when an alarm fires.

## Service levels

| Objective | Target | Measured by |
|---|---|---|
| Ingest availability | 99.9% of batches answered 2xx/4xx, monthly | API Gateway and ingest pod metrics |
| Ingest latency | p99 under 300 ms | `pse_ingest_latency_ms` |
| Decision latency | 90% of automatic charges within 15 minutes of exit | lab gate; `outcomes_charge` timestamps |
| Charge outbox age | no pending charge older than 1 hour | `charge` table, `status = 'pending'` |
| Review queue | answered within 4 hours in opening hours | `pse_reviews_waiting` |

## Ownership

| Area | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Ingest, engine, outbox | Parking platform team | Lead engineer | SRE | Customer success |
| Scanners in the field | Field service | Head of operations | Parking platform team | Site owners |
| Review queue | Parking operations desk | Head of operations | Parking platform team | Finance |
| Payment provider | Finance systems | CFO | Parking platform team | Customer success |

## Playbooks

### Queue backlog
A shard's queue grows: its engine pod is down, restarting (rebuilding from the log) or slow. Check
`kubectl -n parking get pods -l role=engine`, then `/readyz` on that pod. A restart rebuilds from Postgres; nothing
is lost and nothing is decided twice. Do not add consumers to a shard: order matters.

### Ingest slow
Edge devices buffer and resend, so slowness costs latency, not data. Check Postgres insert latency and Keda's
replica count; raise `maxReplicaCount` if CPU-bound.

### Scanner degraded
The CUSUM on low-confidence reads crossed its threshold: dirty lens, misaligned or knocked camera. Open a
field-service ticket with the scanner id; reads from it keep flowing, but more exits go to review.

### Scanner offline
Exits at its site wait (up to 24 hours) for its backlog. Nothing to do in software; field service checks power and
network. After it reconnects, decisions follow within about 20 minutes.

### Review queue
Charges and notices wait for answers. If the crop reader is off (no `ANTHROPIC_API_KEY`, or its errors rise in
`pse_crop_errors_total`), every uncertain exit waits for a person; restore it or add operators.

### PSP outage
Charges stay `pending` in the outbox and are retried with the same idempotency key; nobody can be charged twice.
After six failed attempts a row is marked `failed` for finance to settle.

## Change control
Every change ships through CI: tests on Postgres and Redis, the dev study reproducing its committed report, the
release gates. A change to `config/engine.json` needs the study diff in the merge request. The held-out world is
never re-run; a new one is drawn for a new release line.
