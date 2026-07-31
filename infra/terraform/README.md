# Production AWS baseline

This stack implements the production blueprint as a two-availability-zone AWS deployment. It creates an internet-facing ALB protected by WAF, private ECS Fargate tasks for the web/API, webhook ingester, and workflow worker, Multi-AZ RDS PostgreSQL, encrypted Multi-AZ Redis, KMS, private encrypted S3 storage, CloudWatch logs/alarms, and one NAT gateway per availability zone.

## Safety properties

- The container image must use an immutable `@sha256:` ECR reference.
- Application tasks have no public IP and data subnets have no internet route.
- RDS manages its master password in Secrets Manager. ECS injects its JSON fields as `PGUSER` and `PGPASSWORD`; Terraform never constructs a credential-bearing database URL.
- Runtime secret values are created outside this stack. Only secret ARNs belong in the variables file.
- RDS, S3, logs, and secret decryption use the application KMS key. RDS is Multi-AZ with deletion protection and final snapshots enabled.
- The first apply keeps all services at zero tasks. A successful one-off database migration is required before service activation.
- WAF managed rules and an IP rate limit protect both the dashboard/API and provider webhooks. Provider signatures remain the authoritative webhook authentication layer.

Terraform state contains resource metadata and must still be treated as sensitive. Configure an encrypted, versioned remote backend with state locking according to the organization’s AWS account standard; do not commit local state or plans.

## Deployment sequence

1. Build and push the existing Dockerfile for `linux/amd64`, with the production `VITE_*` build arguments, and record the resulting ECR digest.
2. Create each runtime secret in AWS Secrets Manager using your approved secret-delivery process. Do not pass values through Terraform.
3. Copy `terraform.tfvars.example` to an untracked protected variables file, replace every placeholder, and keep `services_enabled = false`.
4. Run:

   ```sh
   terraform init
   terraform fmt -check
   terraform validate
   terraform plan -out=production.tfplan
   terraform apply production.tfplan
   ```

5. Run migrations as a one-off task using the API task definition and the application network outputs:

   ```sh
   aws ecs run-task \
     --cluster "$(terraform output -raw ecs_cluster_name)" \
     --launch-type FARGATE \
     --task-definition "$(terraform output -raw api_task_definition_arn)" \
     --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json application_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw application_security_group_id)],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"api","command":["node","dist-server/db/migrate.js"]}]}'
   ```

   Wait for the task and require exit code `0`; archive the task ARN and logs as deployment evidence.

6. Set `services_enabled = true`, create and review a second saved plan, then apply it. Confirm both ALB target groups are healthy and each ECS service has at least two running tasks split across the selected AZs.
7. Point DNS at `alb_dns_name`, verify `/livez`, `/readyz`, a dashboard deep link, and signed provider sandbox webhooks. Then run the repository’s protected release validation and location activation procedure.

Conversational voice remains disabled in the example. Before enabling it, add `OPENAI_WEBHOOK_SECRET` as a Secrets Manager ARN, configure the provider TLS SIP trunk and signed OpenAI project webhook, obtain current location-scoped SMS reliability and owner voice-readiness evidence, and complete a controlled sandbox call that verifies the AI/non-recording disclosure, human transfer, silence handling, interruption behavior, and provider-failure fallback. Only then set `OPENAI_REALTIME_SIP_ENABLED=true` in a reviewed plan.

No command in this directory creates DNS records, provider credentials, identity-provider applications, or production activation evidence. Those remain explicit operator-controlled boundaries.
