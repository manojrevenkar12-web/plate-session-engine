terraform {
  required_version = ">= 1.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # State lives in S3 with native locking; configured per environment with `-backend-config`.
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      service     = "plate-session-engine"
      environment = var.environment
      managed-by  = "terraform"
    }
  }
}
