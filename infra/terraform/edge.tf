resource "aws_s3_bucket" "alb_logs" { bucket = "${local.name}-alb-logs-${data.aws_caller_identity.current.account_id}-${var.aws_region}" }
resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}
resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule { id = "expire"
    status = "Enabled"
    filter {}
    expiration { days = 90 } }
}
data "aws_iam_policy_document" "alb_logs" {
  statement {
    sid = "LogDeliveryWrite"
    actions = ["s3:PutObject"]
    principals { type = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"] }
    resources = ["${aws_s3_bucket.alb_logs.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
  }
  statement {
    sid = "LogDeliveryAclCheck"
    actions = ["s3:GetBucketAcl"]
    principals { type = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"] }
    resources = [aws_s3_bucket.alb_logs.arn]
  }
  statement {
    sid = "DenyInsecureTransport"
    effect = "Deny"
    actions = ["s3:*"]
    principals { type = "*"
      identifiers = ["*"] }
    resources = [aws_s3_bucket.alb_logs.arn, "${aws_s3_bucket.alb_logs.arn}/*"]
    condition { test = "Bool"
      variable = "aws:SecureTransport"
      values = ["false"] }
  }
}
resource "aws_s3_bucket_policy" "alb_logs" { bucket = aws_s3_bucket.alb_logs.id
  policy = data.aws_iam_policy_document.alb_logs.json }

resource "aws_lb" "main" {
  name = substr(local.name, 0, 32)
  internal = false
  load_balancer_type = "application"
  security_groups = [aws_security_group.alb.id]
  subnets = values(aws_subnet.public)[*].id
  enable_deletion_protection = true
  drop_invalid_header_fields = true
  access_logs { bucket = aws_s3_bucket.alb_logs.id
    enabled = true }
  depends_on = [aws_s3_bucket_policy.alb_logs]
}

resource "aws_lb_target_group" "service" {
  for_each = { api = 4100, webhook = 4200 }
  name = substr("${local.name}-${each.key}", 0, 32)
  port = each.value
  protocol = "HTTP"
  target_type = "ip"
  vpc_id = aws_vpc.main.id
  deregistration_delay = 30
  health_check { enabled = true
    path = "/readyz"
    matcher = "200"
    interval = 30
    timeout = 5
    healthy_threshold = 2
    unhealthy_threshold = 3 }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port = 80
  protocol = "HTTP"
  default_action { type = "redirect"
    redirect { port = "443"
      protocol = "HTTPS"
      status_code = "HTTP_301" } }
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port = 443
  protocol = "HTTPS"
  certificate_arn = var.certificate_arn
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  default_action { type = "forward"
    target_group_arn = aws_lb_target_group.service["api"].arn }
}
resource "aws_lb_listener_rule" "webhooks" {
  listener_arn = aws_lb_listener.https.arn
  priority = 10
  action { type = "forward"
    target_group_arn = aws_lb_target_group.service["webhook"].arn }
  condition { path_pattern { values = ["/webhooks", "/webhooks/*"] } }
}

resource "aws_wafv2_web_acl" "main" {
  name = local.name
  description = "Managed protections and bounded public request rate"
  scope = "REGIONAL"
  default_action { allow {} }
  visibility_config { cloudwatch_metrics_enabled = true
    metric_name = local.name
    sampled_requests_enabled = true }
  rule {
    name = "AWSManagedCommon"
    priority = 10
    override_action { none {} }
    statement { managed_rule_group_statement { name = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS" } }
    visibility_config { cloudwatch_metrics_enabled = true
      metric_name = "managed-common"
      sampled_requests_enabled = true }
  }
  rule {
    name = "AWSManagedKnownBadInputs"
    priority = 20
    override_action { none {} }
    statement { managed_rule_group_statement { name = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS" } }
    visibility_config { cloudwatch_metrics_enabled = true
      metric_name = "managed-known-bad"
      sampled_requests_enabled = true }
  }
  rule {
    name = "PublicRateLimit"
    priority = 30
    action { block {} }
    statement { rate_based_statement { limit = 2000
        aggregate_key_type = "IP" } }
    visibility_config { cloudwatch_metrics_enabled = true
      metric_name = "public-rate-limit"
      sampled_requests_enabled = true }
  }
}
resource "aws_wafv2_web_acl_association" "main" { resource_arn = aws_lb.main.arn
  web_acl_arn = aws_wafv2_web_acl.main.arn }
