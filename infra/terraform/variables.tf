variable "name" { type = string
  default = "salon-recovery" }
variable "environment" { type = string
  default = "production" }
variable "aws_region" { type = string
  default = "eu-west-2" }
variable "vpc_cidr" { type = string
  default = "10.40.0.0/16" }
variable "availability_zones" {
  type    = list(string)
  default = []
  validation { condition = length(var.availability_zones) == 0 || length(var.availability_zones) >= 2
    error_message = "Provide zero or at least two availability zones." }
}
variable "container_image" {
  type        = string
  description = "Immutable ECR image reference. A sha256 digest is mandatory."
  validation { condition = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "container_image must be pinned by sha256 digest." }
}
variable "certificate_arn" {
  type = string
  validation { condition = can(regex("^arn:aws[a-z-]*:acm:", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN." }
}
variable "runtime_environment" {
  type        = map(string)
  default     = {}
  description = "Non-secret runtime configuration, such as provider URLs and public identifiers."
  validation {
    condition = length(setintersection(toset(keys(var.runtime_environment)), toset(["NODE_ENV", "HOST", "PORT", "WEBHOOK_HOST", "WEBHOOK_PORT", "WORKER_HEALTH_HOST", "WORKER_HEALTH_PORT", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE"]))) == 0
    error_message = "runtime_environment cannot override infrastructure-owned variables."
  }
}
variable "runtime_secret_arns" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = "Environment name to existing Secrets Manager secret ARN. Values never enter Terraform."
}
variable "required_runtime_secret_names" {
  type = set(string)
  default = [
    "CREDENTIAL_ENCRYPTION_KEY_BASE64", "OPENAI_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SQUARE_APPLICATION_SECRET", "SQUARE_WEBHOOK_SIGNATURE_KEY", "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY", "TWILIO_AUTH_TOKEN",
    "PUBLIC_RATE_LIMIT_HASH_KEY"
  ]
}
variable "db_name" { type = string
  default = "salon_recovery" }
variable "db_username" { type = string
  default = "salon_runtime" }
variable "db_instance_class" { type = string
  default = "db.t4g.medium" }
variable "db_deletion_protection" { type = bool
  default = true }
variable "redis_node_type" { type = string
  default = "cache.t4g.small" }
variable "service_desired_count" { type = number
  default = 2
  validation { condition = var.service_desired_count >= 2
    error_message = "Production services require at least two tasks." } }
variable "services_enabled" { type = bool
  default = false
  description = "Keep false for the first apply; enable only after the migration task succeeds." }
variable "service_max_count" { type = number
  default = 8
  validation { condition = var.service_max_count >= 2
    error_message = "service_max_count must be at least two." } }
variable "alarm_email" { type = string
  default = "" }
