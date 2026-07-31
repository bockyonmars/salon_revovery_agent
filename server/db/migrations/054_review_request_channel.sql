ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS channel text;

UPDATE review_requests SET channel = 'sms' WHERE channel IS NULL;
UPDATE review_requests SET record = jsonb_set(record, '{channel}', to_jsonb(channel), true);

ALTER TABLE review_requests ALTER COLUMN channel SET NOT NULL;
ALTER TABLE review_requests DROP CONSTRAINT IF EXISTS review_requests_channel_check;
ALTER TABLE review_requests ADD CONSTRAINT review_requests_channel_check CHECK (channel IN ('sms', 'whatsapp'));

COMMENT ON COLUMN review_requests.channel IS
  'Immutable consent-authorized delivery channel selected when neutral review eligibility is reserved.';
