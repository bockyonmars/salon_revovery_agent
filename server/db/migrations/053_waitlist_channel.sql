ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE waitlist_offers ADD COLUMN IF NOT EXISTS channel text;

UPDATE waitlist_entries SET channel = 'sms' WHERE channel IS NULL;
UPDATE waitlist_entries SET record = jsonb_set(record, '{channel}', to_jsonb(channel), true);

UPDATE waitlist_offers AS offer
SET channel = entry.channel
FROM waitlist_entries AS entry
WHERE entry.id = offer.entry_id
  AND entry.tenant_id = offer.tenant_id
  AND entry.location_id = offer.location_id
  AND offer.channel IS NULL;
UPDATE waitlist_offers SET channel = 'sms' WHERE channel IS NULL;
UPDATE waitlist_offers SET record = jsonb_set(record, '{channel}', to_jsonb(channel), true);

ALTER TABLE waitlist_entries ALTER COLUMN channel SET NOT NULL;
ALTER TABLE waitlist_offers ALTER COLUMN channel SET NOT NULL;

ALTER TABLE waitlist_entries DROP CONSTRAINT IF EXISTS waitlist_entries_channel_check;
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_channel_check CHECK (channel IN ('sms', 'whatsapp'));
ALTER TABLE waitlist_offers DROP CONSTRAINT IF EXISTS waitlist_offers_channel_check;
ALTER TABLE waitlist_offers ADD CONSTRAINT waitlist_offers_channel_check CHECK (channel IN ('sms', 'whatsapp'));

COMMENT ON COLUMN waitlist_entries.channel IS 'Consent-authorized SMS or WhatsApp channel selected when the client joins the waitlist.';
COMMENT ON COLUMN waitlist_offers.channel IS 'Immutable delivery channel copied from the selected waitlist entry.';
