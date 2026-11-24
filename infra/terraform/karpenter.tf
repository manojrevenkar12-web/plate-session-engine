# Karpenter's controller role (EKS Pod Identity) and the queue that tells it about Spot interruptions.

data "aws_iam_policy_document" "pod_identity_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "karpenter" {
  name               = "${local.name}-karpenter"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

data "aws_iam_policy_document" "karpenter" {
  statement {
    sid = "Provisioning"
    actions = [
      "ec2:CreateFleet", "ec2:CreateLaunchTemplate", "ec2:CreateTags", "ec2:DeleteLaunchTemplate", "ec2:RunInstances",
      "ec2:TerminateInstances", "ec2:Describe*", "pricing:GetProducts", "ssm:GetParameter", "eks:DescribeCluster",
      "iam:CreateInstanceProfile", "iam:TagInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
      "iam:DeleteInstanceProfile", "iam:GetInstanceProfile",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "PassNodeRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.node.arn]
  }
  statement {
    sid       = "Interruptions"
    actions   = ["sqs:DeleteMessage", "sqs:GetQueueUrl", "sqs:ReceiveMessage"]
    resources = [aws_sqs_queue.karpenter.arn]
  }
}

resource "aws_iam_role_policy" "karpenter" {
  role   = aws_iam_role.karpenter.id
  policy = data.aws_iam_policy_document.karpenter.json
}

resource "aws_eks_pod_identity_association" "karpenter" {
  cluster_name    = aws_eks_cluster.main.name
  namespace       = "kube-system"
  service_account = "karpenter"
  role_arn        = aws_iam_role.karpenter.arn
}

resource "aws_eks_access_entry" "karpenter_nodes" {
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_role.node.arn
  type          = "EC2_LINUX"
}

resource "aws_sqs_queue" "karpenter" {
  name                      = "${local.name}-karpenter"
  message_retention_seconds = 300
  sqs_managed_sse_enabled   = true
}

resource "aws_cloudwatch_event_rule" "interruptions" {
  for_each = {
    spot      = { source = ["aws.ec2"], "detail-type" = ["EC2 Spot Instance Interruption Warning"] }
    rebalance = { source = ["aws.ec2"], "detail-type" = ["EC2 Instance Rebalance Recommendation"] }
    state     = { source = ["aws.ec2"], "detail-type" = ["EC2 Instance State-change Notification"] }
    health    = { source = ["aws.health"], "detail-type" = ["AWS Health Event"] }
  }
  name          = "${local.name}-karpenter-${each.key}"
  event_pattern = jsonencode(each.value)
}

resource "aws_cloudwatch_event_target" "interruptions" {
  for_each = aws_cloudwatch_event_rule.interruptions
  rule     = each.value.name
  arn      = aws_sqs_queue.karpenter.arn
}

data "aws_iam_policy_document" "karpenter_queue" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.karpenter.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "sqs.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue_policy" "karpenter" {
  queue_url = aws_sqs_queue.karpenter.id
  policy    = data.aws_iam_policy_document.karpenter_queue.json
}
