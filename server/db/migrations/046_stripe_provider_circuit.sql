ALTER TABLE provider_circuit_breakers
  DROP CONSTRAINT IF EXISTS provider_circuit_breakers_provider_check;

ALTER TABLE provider_circuit_breakers
  ADD CONSTRAINT provider_circuit_breakers_provider_check
  CHECK (provider IN ('square', 'twilio', 'openai', 'postmark', 'stripe'));

COMMENT ON CONSTRAINT provider_circuit_breakers_provider_check ON provider_circuit_breakers IS
  'Allowlisted external providers protected by the shared tenant/location circuit breaker.';
