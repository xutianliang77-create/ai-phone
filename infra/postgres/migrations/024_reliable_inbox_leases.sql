BEGIN;

ALTER TABLE ai_phone.reliable_inbox_events
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reliable_inbox_lease_pair_check'
      AND conrelid = 'ai_phone.reliable_inbox_events'::regclass
  ) THEN
    ALTER TABLE ai_phone.reliable_inbox_events
      ADD CONSTRAINT reliable_inbox_lease_pair_check
      CHECK ((lease_owner IS NULL) = (lease_until IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reliable_inbox_attempts_check'
      AND conrelid = 'ai_phone.reliable_inbox_events'::regclass
  ) THEN
    ALTER TABLE ai_phone.reliable_inbox_events
      ADD CONSTRAINT reliable_inbox_attempts_check CHECK (attempts >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS reliable_inbox_claim_idx
  ON ai_phone.reliable_inbox_events(lease_until, received_at, event_id)
  WHERE processed_at IS NULL;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('024_reliable_inbox_leases')
ON CONFLICT (version) DO NOTHING;

COMMIT;
