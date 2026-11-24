# 0006: Platform: NestJS on Fastify, BullMQ shards, Prisma on Postgres, EKS, Lambda, GitLab, Datadog

## Decision
- **Services**: one NestJS (Fastify) image with three roles. `ingest` validates, stores each event once (one
  `INSERT … ON CONFLICT DO NOTHING RETURNING` per batch) and queues; stateless, scaled by Keda. `engine` consumes one
  shard queue alone (BullMQ, concurrency 1), because a site's events must be decided in arrival order; a
  StatefulSet pod per shard, on on-demand nodes, rebuilt from Postgres on start. `all` runs both for development.
- **High-throughput front door**: the same ingest as an AWS Lambda behind API Gateway (Serverless Framework),
  writing to the same Postgres table and Redis queues.
- **Data**: Prisma 7 with the pg driver adapter; the migration is committed SQL. Redis (ElastiCache) only holds
  queues; Postgres is the source of truth.
- **Infrastructure**: Terraform for VPC, EKS (Pod Identity, KMS-encrypted secrets, private endpoint), Karpenter's
  IAM and interruption queue, RDS Postgres, ElastiCache, ECR and SSM parameters. Karpenter node pools on arm64,
  Spot for ingest, on-demand for engines.
- **Observability**: OpenTelemetry traces over OTLP (the Datadog Agent accepts OTLP), OpenMetrics at `/metrics`
  scraped by the Agent, Datadog monitors in `deploy/datadog/monitors.json`.
- **CI/CD**: GitHub Actions for this repository; `.gitlab-ci.yml` with the same checks plus kaniko builds and
  kustomize deploys, for a GitLab shop.

## Consequences
- Measured on one development VM: the engine decides about 87,000 events a second on one core; ingest takes
  11,662 reads a second at p99 94 ms on Postgres and BullMQ. Peter Park-scale traffic (thousands of transactions
  an hour) is far below either; the shards exist for isolation and recovery time, not raw load.
- Terraform is validated in CI, not applied; the manifests have not run on a cluster.
