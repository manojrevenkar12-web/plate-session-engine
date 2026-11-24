# SKILLS.md

Repeatable tasks, step by step.

## Change a threshold or weight in the engine
1. Edit `config/engine.json`; never a number in code.
2. `pnpm study`, read every design's change in `reports/dev.json`, then `pnpm readme`.
3. If a gate moves, say why in the commit. The held-out world is not re-run.

## Add a fault to the world (a new way scanners or drivers go wrong)
1. Add its rate to `config/world.json` (and a held-out value to `config/heldout.json`).
2. Generate it in `packages/world/src/world.ts` with a keyed draw: `rng(seed, purpose, key)`.
3. Record its truth where the lab can score it; add a test in `world.test.ts`.

## Add a design or an ablation
1. A baseline goes in `packages/lab/src/baselines.ts`; an ablation is a switch in `EngineOptions`.
2. Register it in `config/designs.json`; `pnpm study && pnpm readme`.

## Run the stack locally
1. `docker compose up` (Postgres, Redis, migration, the API in "all" mode), or `pnpm api` for memory and inline.
2. `POST /v1/edge/events` with `x-edge-token`; read `GET /v1/sessions`, `GET /v1/reviews`, `GET /v1/scanners`,
   `GET /metrics` with `authorization: Bearer <operator token>`.

## Answer a review
`POST /v1/reviews/<id>/answer` with `{ "answer": {...}, "minutes": 1.5, "operator": "op-7" }`. The answer is kept
before it is applied, so a crash replays it. A second answer to the same review is refused with 404.

## Measure throughput
`pnpm bench` (engine, one core) and `pnpm --filter @pse/api bench` (ingest; set `DATABASE_URL` and `REDIS_URL`
for Postgres and BullMQ, and apply the schema first with `packages/store/src/migrate-cli.ts`). Results go to
`reports/bench.json`, labelled with the machine.

## Deploy
Terraform in `infra/terraform` (state in S3), manifests in `deploy/k8s` (kustomize), the ingest Lambda with
`apps/api/serverless.yml`. GitLab CI (`.gitlab-ci.yml`) builds the image with kaniko and deploys staging.
