ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS location_id text;

UPDATE idempotency_keys AS idem
SET location_id = booking.location_id
FROM bookings AS booking
WHERE idem.booking_id = booking.id
  AND idem.tenant_id = booking.tenant_id
  AND idem.location_id IS NULL;

ALTER TABLE idempotency_keys
  ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_pkey;

ALTER TABLE idempotency_keys
  ADD PRIMARY KEY (tenant_id, location_id, idempotency_key);
