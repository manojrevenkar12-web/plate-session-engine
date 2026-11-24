variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "kubernetes_version" {
  type    = string
  default = "1.33"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "shards" {
  description = "ordered edge-event queues; each has one engine consumer"
  type        = number
  default     = 4
}
