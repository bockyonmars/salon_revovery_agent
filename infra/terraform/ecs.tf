locals {
  services = {
    api = { port = 4100, cpu = 512, memory = 1024, command = ["node", "dist-server/index.js"], host_name = "HOST", port_name = "PORT" }
    webhook = { port = 4200, cpu = 512, memory = 1024, command = ["node", "dist-server/webhook-index.js"], host_name = "WEBHOOK_HOST", port_name = "WEBHOOK_PORT" }
    worker = { port = 4300, cpu = 1024, memory = 2048, command = ["node", "dist-server/workflow-index.js"], host_name = "WORKER_HEALTH_HOST", port_name = "WORKER_HEALTH_PORT" }
  }
  base_environment = {
    NODE_ENV = "production"
    PGHOST = aws_db_instance.main.address
    PGPORT = tostring(aws_db_instance.main.port)
    PGDATABASE = var.db_name
    PGSSLMODE = "require"
    S3_BUCKET = aws_s3_bucket.application.id
    REDIS_HOST = aws_elasticache_replication_group.main.primary_endpoint_address
    REDIS_PORT = "6379"
  }
  secret_environment = concat(
    [
      { name = "PGUSER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" }
    ],
    [for name, arn in var.runtime_secret_arns : { name = name, valueFrom = arn }]
  )
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  setting { name = "containerInsights"
    value = "enhanced" }
}
resource "aws_cloudwatch_log_group" "service" {
  for_each = local.services
  name = "/ecs/${local.name}/${each.key}"
  retention_in_days = 30
  kms_key_id = aws_kms_key.application.arn
}

resource "aws_ecs_task_definition" "service" {
  for_each = local.services
  family = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = each.value.cpu
  memory = each.value.memory
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn = aws_iam_role.task.arn
  runtime_platform { operating_system_family = "LINUX"
    cpu_architecture = "X86_64" }
  container_definitions = jsonencode([{
    name = each.key
    image = var.container_image
    essential = true
    readonlyRootFilesystem = true
    command = each.value.command
    portMappings = [{ name = each.key, containerPort = each.value.port, hostPort = each.value.port, protocol = "tcp" }]
    environment = concat(
      [for name, value in merge(local.base_environment, var.runtime_environment) : { name = name, value = value }],
      [{ name = each.value.host_name, value = "0.0.0.0" }, { name = each.value.port_name, value = tostring(each.value.port) }]
    )
    secrets = local.secret_environment
    linuxParameters = { initProcessEnabled = true }
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.service[each.key].name, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = each.key } }
    healthCheck = { command = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${each.value.port}/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval = 30, timeout = 5, retries = 3, startPeriod = 30 }
  }])
  lifecycle {
    precondition {
      condition = alltrue([for name in var.required_runtime_secret_names : contains(keys(var.runtime_secret_arns), name)])
      error_message = "runtime_secret_arns is missing one or more required production secrets."
    }
  }
}

resource "aws_ecs_service" "service" {
  for_each = local.services
  name = each.key
  cluster = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count = var.services_enabled ? var.service_desired_count : 0
  launch_type = "FARGATE"
  platform_version = "LATEST"
  enable_execute_command = false
  health_check_grace_period_seconds = each.key == "worker" ? null : 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent = 200
  deployment_circuit_breaker { enable = true
    rollback = true }
  network_configuration { subnets = values(aws_subnet.application)[*].id
    security_groups = [aws_security_group.application.id]
    assign_public_ip = false }
  dynamic "load_balancer" {
    for_each = each.key == "worker" ? [] : [each.key]
    content { target_group_arn = aws_lb_target_group.service[load_balancer.value].arn
      container_name = each.key
      container_port = each.value.port }
  }
  depends_on = [aws_lb_listener.https, aws_lb_listener_rule.webhooks]
}

resource "aws_appautoscaling_target" "service" {
  for_each = local.services
  max_capacity = var.service_max_count
  min_capacity = var.services_enabled ? var.service_desired_count : 0
  resource_id = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.service[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace = "ecs"
}
resource "aws_appautoscaling_policy" "cpu" {
  for_each = local.services
  name = "${local.name}-${each.key}-cpu"
  policy_type = "TargetTrackingScaling"
  resource_id = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  service_namespace = aws_appautoscaling_target.service[each.key].service_namespace
  target_tracking_scaling_policy_configuration { predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    target_value = 60
    scale_in_cooldown = 300
    scale_out_cooldown = 60 }
}
