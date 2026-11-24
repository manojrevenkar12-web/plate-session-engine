data "aws_iam_policy_document" "eks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${local.name}-cluster"
  assume_role_policy = data.aws_iam_policy_document.eks_assume.json
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "main" {
  name     = local.name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  access_config {
    authentication_mode = "API"
  }

  vpc_config {
    subnet_ids              = aws_subnet.private[*].id
    endpoint_private_access = true
    endpoint_public_access  = false
  }

  encryption_config {
    resources = ["secrets"]
    provider {
      key_arn = aws_kms_key.main.arn
    }
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator"]
  depends_on                = [aws_iam_role_policy_attachment.cluster]
}

resource "aws_kms_key" "main" {
  description         = "${local.name} secrets and data at rest"
  enable_key_rotation = true
}

data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${local.name}-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ])
  role       = aws_iam_role.node.name
  policy_arn = each.value
}

# A small fixed group runs Karpenter, Keda and the system pods; Karpenter adds nodes for everything else.
resource "aws_eks_node_group" "system" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "system"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = aws_subnet.private[*].id
  instance_types  = ["m7g.large"]
  ami_type        = "AL2023_ARM_64_STANDARD"

  scaling_config {
    desired_size = 2
    min_size     = 2
    max_size     = 3
  }

  labels = { "workload" = "system" }

  taint {
    key    = "CriticalAddonsOnly"
    value  = "true"
    effect = "NO_SCHEDULE"
  }

  depends_on = [aws_iam_role_policy_attachment.node]
}

resource "aws_eks_addon" "addons" {
  for_each     = toset(["vpc-cni", "coredns", "kube-proxy", "eks-pod-identity-agent"])
  cluster_name = aws_eks_cluster.main.name
  addon_name   = each.value
  depends_on   = [aws_eks_node_group.system]
}
