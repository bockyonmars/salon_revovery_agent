# Operational telemetry boundary

Production automatically emits one-line JSON lifecycle and request-completion records to standard output for collection by the ECS `awslogs` driver. Development can exercise the same boundary with `OPERATIONAL_LOGGING_ENABLED=true`.

Request records contain only timestamp, severity, service, event, validated request ID, HTTP method, registered route template, status, and bounded duration. They never contain the raw URL or query, IP address, request/response body, headers, authorization value, destination, customer identifier, provider payload, or exception message. Unmatched URLs are labelled `unmatched`, and parameterized routes retain their template rather than the supplied identifier.

An incoming `X-Request-ID` is accepted only when it is 8–128 characters from the restricted operational token alphabet. Every other value is replaced with a server-generated UUID. The accepted value is returned as `X-Request-ID` so support can correlate the browser, ALB access record, application request, and provider-safe incident evidence without using customer data.

Service startup, shutdown, health-listener failures, and workflow-tick failures use the same schema. Exceptions are reduced to a bounded code or class name; messages and stacks are not written. Detailed customer or provider investigation must use the authenticated tenant interfaces, audit chain, reconciliation records, and external provider consoles—not application logs.

CloudWatch log groups use the application KMS key and retain records for 30 days in the Terraform baseline. Restrict log access as production customer-data-adjacent operational metadata, export only aggregate metrics, and configure alarms through the encrypted SNS topic. Do not increase payload detail to make debugging easier; add a new bounded evidence record instead.
