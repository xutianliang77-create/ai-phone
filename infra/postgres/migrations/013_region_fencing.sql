BEGIN;

ALTER TABLE ai_phone.communication_sessions
  ADD COLUMN IF NOT EXISTS home_region text,
  ADD COLUMN IF NOT EXISTS home_cell_id text,
  ADD COLUMN IF NOT EXISTS routing_generation integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS communication_sessions_home_region_idx
  ON ai_phone.communication_sessions(home_region, status, updated_at);

CREATE SEQUENCE IF NOT EXISTS ai_phone.aggregate_fencing_token_seq;

CREATE TABLE IF NOT EXISTS ai_phone.aggregate_writer_leases (
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(aggregate_type, aggregate_id)
);

CREATE INDEX IF NOT EXISTS aggregate_writer_leases_expiry_idx
  ON ai_phone.aggregate_writer_leases(lease_until);

CREATE OR REPLACE FUNCTION ai_phone.acquire_aggregate_writer_lease(
  target_type text,
  target_id text,
  target_owner text,
  lease_seconds integer
) RETURNS ai_phone.aggregate_writer_leases
LANGUAGE plpgsql
AS $$
DECLARE
  acquired ai_phone.aggregate_writer_leases;
BEGIN
  IF length(target_type) < 2 OR length(target_id) < 1 OR
    length(target_owner) < 8 OR lease_seconds < 5 OR lease_seconds > 120 THEN
    RAISE EXCEPTION 'Invalid aggregate lease parameters';
  END IF;
  INSERT INTO ai_phone.aggregate_writer_leases(
    aggregate_type, aggregate_id, owner_id, fencing_token, lease_until
  ) VALUES (
    target_type, target_id, target_owner,
    nextval('ai_phone.aggregate_fencing_token_seq'),
    now() + make_interval(secs => lease_seconds)
  )
  ON CONFLICT(aggregate_type, aggregate_id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id,
    fencing_token = nextval('ai_phone.aggregate_fencing_token_seq'),
    lease_until = EXCLUDED.lease_until,
    updated_at = now()
  WHERE ai_phone.aggregate_writer_leases.lease_until <= now()
    OR ai_phone.aggregate_writer_leases.owner_id = target_owner
  RETURNING * INTO acquired;
  RETURN acquired;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('013_region_fencing')
ON CONFLICT (version) DO NOTHING;

COMMIT;
