data "aws_availability_zones" "available" { state = "available" }

locals {
  name = "${var.name}-${var.environment}"
  azs  = length(var.availability_zones) >= 2 ? slice(var.availability_zones, 0, 2) : slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id
  tags = { Name = local.name } }

resource "aws_subnet" "public" {
  for_each                = toset(local.azs)
  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.value
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, index(local.azs, each.value))
  map_public_ip_on_launch = false
  tags = { Name = "${local.name}-public-${each.value}", Tier = "public" }
}

resource "aws_subnet" "application" {
  for_each          = toset(local.azs)
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, index(local.azs, each.value) + 4)
  tags = { Name = "${local.name}-app-${each.value}", Tier = "private-application" }
}

resource "aws_subnet" "data" {
  for_each          = toset(local.azs)
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, index(local.azs, each.value) + 8)
  tags = { Name = "${local.name}-data-${each.value}", Tier = "private-data" }
}

resource "aws_eip" "nat" { for_each = toset(local.azs)
  domain = "vpc"
  tags = { Name = "${local.name}-nat-${each.value}" } }
resource "aws_nat_gateway" "main" {
  for_each      = toset(local.azs)
  allocation_id = aws_eip.nat[each.value].id
  subnet_id     = aws_subnet.public[each.value].id
  depends_on    = [aws_internet_gateway.main]
  tags = { Name = "${local.name}-${each.value}" }
}

resource "aws_route_table" "public" { vpc_id = aws_vpc.main.id
  tags = { Name = "${local.name}-public" } }
resource "aws_route" "public" { route_table_id = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id = aws_internet_gateway.main.id }
resource "aws_route_table_association" "public" { for_each = aws_subnet.public
  subnet_id = each.value.id
  route_table_id = aws_route_table.public.id }
resource "aws_route_table" "application" { for_each = toset(local.azs)
  vpc_id = aws_vpc.main.id
  tags = { Name = "${local.name}-app-${each.value}" } }
resource "aws_route" "application" { for_each = toset(local.azs)
  route_table_id = aws_route_table.application[each.value].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id = aws_nat_gateway.main[each.value].id }
resource "aws_route_table_association" "application" { for_each = aws_subnet.application
  subnet_id = each.value.id
  route_table_id = aws_route_table.application[each.key].id }
resource "aws_route_table" "data" { vpc_id = aws_vpc.main.id
  tags = { Name = "${local.name}-data" } }
resource "aws_route_table_association" "data" { for_each = aws_subnet.data
  subnet_id = each.value.id
  route_table_id = aws_route_table.data.id }

resource "aws_security_group" "alb" {
  name = "${local.name}-alb"
  description = "Public HTTPS entrypoint"
  vpc_id = aws_vpc.main.id
  ingress { description = "HTTPS"
    from_port = 443
    to_port = 443
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"] }
  ingress { description = "HTTP redirect"
    from_port = 80
    to_port = 80
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"] }
  egress { from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"] }
}
resource "aws_security_group" "application" {
  name = "${local.name}-application"
  description = "Fargate tasks"
  vpc_id = aws_vpc.main.id
  ingress { description = "API from ALB"
    from_port = 4100
    to_port = 4100
    protocol = "tcp"
    security_groups = [aws_security_group.alb.id] }
  ingress { description = "Webhook from ALB"
    from_port = 4200
    to_port = 4200
    protocol = "tcp"
    security_groups = [aws_security_group.alb.id] }
  egress { from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"] }
}
resource "aws_security_group" "database" {
  name = "${local.name}-database"
  description = "PostgreSQL from application tasks"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 5432
    to_port = 5432
    protocol = "tcp"
    security_groups = [aws_security_group.application.id] }
}
resource "aws_security_group" "redis" {
  name = "${local.name}-redis"
  description = "Redis from application tasks"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 6379
    to_port = 6379
    protocol = "tcp"
    security_groups = [aws_security_group.application.id] }
}
