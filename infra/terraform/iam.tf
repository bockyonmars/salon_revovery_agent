data "aws_iam_policy_document" "ecs_assume" {
  statement { actions = ["sts:AssumeRole"]
    principals { type = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"] } }
}
resource "aws_iam_role" "execution" { name = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json }
resource "aws_iam_role_policy_attachment" "execution" { role = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" }
data "aws_iam_policy_document" "execution_secrets" {
  statement { actions = ["secretsmanager:GetSecretValue"]
    resources = concat(values(var.runtime_secret_arns), [aws_db_instance.main.master_user_secret[0].secret_arn]) }
  statement { actions = ["kms:Decrypt"]
    resources = [aws_kms_key.application.arn] }
}
resource "aws_iam_role_policy" "execution_secrets" { name = "runtime-secret-delivery"
  role = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json }

resource "aws_iam_role" "task" { name = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json }
data "aws_iam_policy_document" "task" {
  statement { actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.application.arn}/*"] }
  statement { actions = ["s3:ListBucket"]
    resources = [aws_s3_bucket.application.arn] }
  statement { actions = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.application.arn] }
}
resource "aws_iam_role_policy" "task" { name = "application-data"
  role = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json }
