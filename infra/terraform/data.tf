resource "aws_kms_key" "application" {
  description = "${local.name} application data"
  enable_key_rotation = true
  deletion_window_in_days = 30
  policy = data.aws_iam_policy_document.kms.json
}
data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals { type = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"] }
  }
  statement {
    sid = "CloudWatchLogsEncryption"
    actions = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]
    principals { type = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"] }
    condition {
      test = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name}/*"]
    }
  }
  statement {
    sid = "CloudWatchAlarmNotifications"
    actions = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals { type = "Service"
      identifiers = ["cloudwatch.amazonaws.com"] }
  }
}
resource "aws_kms_alias" "application" { name = "alias/${local.name}"
  target_key_id = aws_kms_key.application.key_id }

resource "aws_db_subnet_group" "main" { name = local.name
  subnet_ids = values(aws_subnet.data)[*].id }
resource "aws_db_instance" "main" {
  identifier                     = local.name
  engine                         = "postgres"
  instance_class                 = var.db_instance_class
  allocated_storage              = 50
  max_allocated_storage          = 200
  storage_type                   = "gp3"
  storage_encrypted              = true
  kms_key_id                     = aws_kms_key.application.arn
  db_name                        = var.db_name
  username                       = var.db_username
  manage_master_user_password    = true
  master_user_secret_kms_key_id  = aws_kms_key.application.arn
  multi_az                       = true
  publicly_accessible            = false
  db_subnet_group_name           = aws_db_subnet_group.main.name
  vpc_security_group_ids         = [aws_security_group.database.id]
  backup_retention_period        = 14
  backup_window                  = "02:00-03:00"
  maintenance_window             = "sun:03:30-sun:04:30"
  auto_minor_version_upgrade     = true
  performance_insights_enabled   = true
  performance_insights_kms_key_id = aws_kms_key.application.arn
  deletion_protection            = var.db_deletion_protection
  skip_final_snapshot            = false
  final_snapshot_identifier      = "${local.name}-final"
  copy_tags_to_snapshot          = true
}

resource "aws_elasticache_subnet_group" "main" { name = local.name
  subnet_ids = values(aws_subnet.data)[*].id }
resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.name
  description                = "${local.name} operational cache"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  snapshot_retention_limit   = 7
  maintenance_window         = "sun:05:00-sun:06:00"
  apply_immediately          = false
}

resource "aws_s3_bucket" "application" { bucket = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}" }
resource "aws_s3_bucket_public_access_block" "application" {
  bucket = aws_s3_bucket.application.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "application" { bucket = aws_s3_bucket.application.id
  versioning_configuration { status = "Enabled" } }
resource "aws_s3_bucket_server_side_encryption_configuration" "application" {
  bucket = aws_s3_bucket.application.id
  rule { apply_server_side_encryption_by_default { kms_master_key_id = aws_kms_key.application.arn
      sse_algorithm = "aws:kms" }
    bucket_key_enabled = true }
}
resource "aws_s3_bucket_lifecycle_configuration" "application" {
  bucket = aws_s3_bucket.application.id
  rule { id = "retention"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 } }
}
data "aws_iam_policy_document" "application_bucket" {
  statement {
    sid = "DenyInsecureTransport"
    effect = "Deny"
    actions = ["s3:*"]
    resources = [aws_s3_bucket.application.arn, "${aws_s3_bucket.application.arn}/*"]
    principals { type = "*"
      identifiers = ["*"] }
    condition { test = "Bool"
      variable = "aws:SecureTransport"
      values = ["false"] }
  }
}
resource "aws_s3_bucket_policy" "application" {
  bucket = aws_s3_bucket.application.id
  policy = data.aws_iam_policy_document.application_bucket.json
}
data "aws_caller_identity" "current" {}
