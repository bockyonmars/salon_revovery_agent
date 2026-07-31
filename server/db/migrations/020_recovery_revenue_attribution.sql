ALTER TABLE revenue_attribution
  ALTER COLUMN waitlist_offer_id DROP NOT NULL;

ALTER TABLE revenue_attribution
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS evidence text,
  ADD COLUMN IF NOT EXISTS touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_correlation_id text;

UPDATE revenue_attribution
SET source_id=COALESCE(source_id,waitlist_offer_id::text),
    evidence=COALESCE(evidence,'accepted_waitlist_offer'),
    touch_at=COALESCE(touch_at,verified_at)
WHERE source_id IS NULL OR evidence IS NULL OR touch_at IS NULL;

ALTER TABLE revenue_attribution
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN evidence SET NOT NULL,
  ALTER COLUMN touch_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS revenue_attribution_one_booking_idx
  ON revenue_attribution (booking_id);

CREATE INDEX IF NOT EXISTS revenue_attribution_source_idx
  ON revenue_attribution (tenant_id,location_id,attribution_type,source_id);
