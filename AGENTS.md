# AGENTS.md

How to work in this repository, for people and coding agents alike.

## Fast feedback

| Command | What it does | Time |
|---|---|---|
| `pnpm --filter @pse/store generate` | generates the Prisma client (once, and after a schema change) | 2 s |
| `pnpm typecheck` | `tsc` strict in every package, `vue-tsc` in the console | 15 s |
| `pnpm test` | every package's tests through Turborepo | 20 s |
| `pnpm study` | the dev study: 3 seeds × 11 designs, about 240,000 stays | 4 min on two cores |
| `pnpm readme` | regenerates the README results block from `reports/` | 1 s |
| `pnpm bench` | measures the engine's events a second on this machine | 30 s |

Set `PSE_TEST_DATABASE_URL` and `PSE_TEST_REDIS_URL` to also run the store contract on Postgres and the API end to
end on Prisma and BullMQ; CI runs them on `postgres:16` and `redis:7` services. Generating the Prisma client offline:
`PRISMA_SCHEMA_ENGINE_BINARY=/path/to/any/file pnpm --filter @pse/store generate` (generation needs no engine).

## Layout

| Package | What it is | May import |
|---|---|---|
| `packages/domain` | events, plates, tariffs, keyed luck, the ports | nothing |
| `packages/engine` | the session engine: dedupe, watermarks, matching, billing, reviews, scanner health | domain |
| `packages/store` | event log, decisions, charge outbox, answers: Prisma on Postgres, and memory | domain, engine (types) |
| `packages/world` | the simulated car parks and their truth, and the simulated operator, model and payment provider | domain |
| `packages/lab` | baselines, designs, scoring, the study, the README block | everything |
| `apps/api` | NestJS on Fastify: ingest, sessions, reviews, scanners; BullMQ workers; the Lambda handler | domain, engine, store |
| `apps/console` | Vue results console over `reports/*.json` | nothing at runtime |

## Invariants

1. **The truth stays in the world.** No product package (domain, engine, store, api, console) imports `world` or
   `lab`. Only the lab reads the truth, and only to score after the fact. `packages/lab/src/lab.test.ts` checks it.
2. **The world does not read the engine's settings.** `world` imports only `domain` and reads only
   `config/world.json` and `config/heldout.json`; it keeps its own copy of the tariffs. Checked in `world.test.ts`.
3. **Same luck for every design.** Every draw is keyed by seed, purpose and what it is about (a visit, a pass, a
   read, a charge attempt), never by call order, so every design sees the same cars, misreads and outages.
4. **The model reads, code decides.** The crop reader only proposes an entry for an exit. The engine accepts the
   pick only if it is one of its own candidates, plausible on its own evidence and confident; otherwise a person
   decides, with the pick shown as a suggestion. The model never prices, charges or sends a notice.
5. **Every write is idempotent; a stay is charged once.** An event id, a decision (session, kind), a charge key
   and a review answer are each stored once. Charges go through an outbox and carry an idempotency key to the
   payment provider. Replaying the log rebuilds the same decisions (`api.test.ts`, `integration.test.ts`).
6. **A letter names a certain plate.** A payment notice goes out only when every read agrees or exactly one
   spelling fits the plate grammar with no registered lookalike; otherwise a person reads the plate.
7. **Settings in config.**

   | File | Holds |
   |---|---|
   | `config/engine.json` | windows, holds, matching weights, review economics, health thresholds |
   | `config/tariffs.json` | the engine's tariffs |
   | `config/designs.json` | designs and ablations in the study |
   | `config/gates.json` | release gates |
   | `config/world.json`, `config/heldout.json` | the worlds (with the world's own tariffs) |

8. **Generated reports.** `reports/*.json` come from `pnpm study`; the README block from `pnpm readme`; the
   console's data from `apps/console/scripts/copy-reports.mjs`. Never edit them by hand. CI reruns the dev study
   and fails if the result differs from the committed report.

## The held-out rule

Every choice was made on the dev world (seeds 1, 2, 3): the matching weights, the review band and its economics,
the watermark and settle times, the health thresholds, the plate grammar and the gates. The held-out world
(`config/heldout.json`, seeds 101 and 102) differs: Austrian plates, December, more airports, more scanners
offline and for longer, more misreads, duplicates and typos, fewer registered drivers.

It ran once, after commit `00793a5` froze the code (`reports/heldout.lock` names the config hash). A second run
exits with code 3. Results that missed a gate stay in the README as they are; fixing them on the held-out world
would make it a second dev world.
