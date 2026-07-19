BEGIN;

ALTER TABLE ai_phone.projection_records
  ADD COLUMN IF NOT EXISTS record_version bigint NOT NULL DEFAULT 1;

ALTER TABLE ai_phone.projection_records
  DROP CONSTRAINT IF EXISTS projection_records_record_version_check;
ALTER TABLE ai_phone.projection_records
  ADD CONSTRAINT projection_records_record_version_check
  CHECK (record_version > 0);

CREATE OR REPLACE FUNCTION ai_phone.assert_aggregate_writer_fence(
  target_type text,
  target_id text,
  target_owner text,
  target_token bigint
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  current_lease ai_phone.aggregate_writer_leases;
BEGIN
  SELECT * INTO current_lease
  FROM ai_phone.aggregate_writer_leases
  WHERE aggregate_type = target_type AND aggregate_id = target_id
  FOR SHARE;

  IF current_lease.aggregate_id IS NULL OR
    current_lease.owner_id <> target_owner OR
    current_lease.fencing_token <> target_token OR
    current_lease.lease_until <= now() THEN
    RAISE EXCEPTION 'aggregate writer fence rejected';
  END IF;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('015_primary_record_unit_of_work')
ON CONFLICT (version) DO NOTHING;

COMMIT;
