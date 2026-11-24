# Environments

| Environment | State key | Notes |
|---|---|---|
| staging | `pse/staging/terraform.tfstate` | single-AZ Postgres and Redis, no deletion protection |
| production | `pse/production/terraform.tfstate` | Multi-AZ Postgres, Redis with failover, deletion protection |

```bash
terraform init -backend-config="bucket=<state-bucket>" -backend-config="key=pse/staging/terraform.tfstate" \
  -backend-config="region=eu-central-1" -backend-config="use_lockfile=true"
terraform plan -var environment=staging
```
