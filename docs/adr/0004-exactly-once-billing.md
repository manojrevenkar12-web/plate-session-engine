# 0004: Exactly-once billing through an outbox and idempotency keys

## Context
Payment providers time out, and sometimes they had already taken the money. Retrying without a key charges the
driver twice; not retrying loses the charge. Edge devices and queues redeliver events.

## Decision
- The engine never calls a provider. Its port writes the charge to an outbox row whose primary key is the
  stay's charge key; a worker (BullMQ, retries with exponential backoff) calls the provider with that key as the
  `Idempotency-Key`, until it answers.
- Every event, decision, charge key and review answer is stored once under a unique constraint, so retries of any
  kind are no-ops; the engine rebuilds its state from the event log and the answers after a restart.

## Consequences
- Double charges: 0, against 302 for exact matching with plain retries (dev); 0 against 161 (held-out).
- A charge is "decided" before it is "taken": finance sees outbox rows that are pending or failed, not a gap.
