CREATE TABLE IF NOT EXISTS public_recovery_reviews (
  id uuid PRIMARY KEY,
  submission_key uuid NOT NULL UNIQUE,
  business_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('new','contacted','qualified','closed')),
  marketing_consent boolean NOT NULL DEFAULT false,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS public_recovery_reviews_status_created_idx
  ON public_recovery_reviews (status, created_at DESC);

CREATE INDEX IF NOT EXISTS public_recovery_reviews_retention_idx
  ON public_recovery_reviews (retention_expires_at)
  WHERE status = 'closed';

COMMENT ON TABLE public_recovery_reviews IS
  'Public acquisition requests. Marketing nurture is permitted only when record.marketingConsent is true and carries a capture timestamp.';
