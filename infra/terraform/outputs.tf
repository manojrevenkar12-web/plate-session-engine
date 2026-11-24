output "cluster_name" {
  value = aws_eks_cluster.main.name
}

output "ecr_repository" {
  value = aws_ecr_repository.api.repository_url
}

output "private_subnets" {
  description = "for the ingest Lambda (serverless.yml param privateSubnets)"
  value       = aws_subnet.private[*].id
}

output "lambda_security_group" {
  value = aws_security_group.lambda.id
}

output "karpenter_queue" {
  value = aws_sqs_queue.karpenter.name
}

output "shards" {
  value = var.shards
}
