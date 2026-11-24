# Postgres for the event log, decisions and the charge outbox; Redis for the BullMQ queues.

resource "aws_security_group" "data" {
  name   = "${local.name}-data"
  vpc_id = aws_vpc.main.id
  ingress {
    description     = "Postgres from the cluster and the ingest Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id, aws_security_group.lambda.id]
  }
  ingress {
    description     = "Redis from the cluster and the ingest Lambda"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id, aws_security_group.lambda.id]
  }
}

resource "aws_security_group" "lambda" {
  name   = "${local.name}-lambda"
  vpc_id = aws_vpc.main.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = 50
  max_allocated_storage        = 500
  storage_encrypted            = true
  kms_key_id                   = aws_kms_key.main.arn
  db_name                      = "pse"
  username                     = "pse"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.data.id]
  multi_az                     = var.environment == "production"
  backup_retention_period      = 14
  deletion_protection          = var.environment == "production"
  performance_insights_enabled = true
  skip_final_snapshot          = var.environment != "production"
  final_snapshot_identifier    = "${local.name}-final"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.name
  description                = "BullMQ queues for plate-session-engine"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  # BullMQ needs keys to stay until they are processed.
  parameter_group_name = "default.redis7"
}

resource "aws_ecr_repository" "api" {
  name                 = "plate-session-engine/api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.main.arn
  }
}

resource "aws_ssm_parameter" "database_url" {
  name   = "/pse/${var.environment}/database-url"
  type   = "SecureString"
  key_id = aws_kms_key.main.arn
  value  = "postgresql://pse:${random_password.db.result}@${aws_db_instance.main.address}:5432/pse?sslmode=require"
}

resource "aws_ssm_parameter" "redis_url" {
  name   = "/pse/${var.environment}/redis-url"
  type   = "SecureString"
  key_id = aws_kms_key.main.arn
  value  = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}
