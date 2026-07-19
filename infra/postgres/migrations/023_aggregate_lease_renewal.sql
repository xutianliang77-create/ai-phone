BEGIN;

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
    fencing_token = CASE
      WHEN ai_phone.aggregate_writer_leases.owner_id = EXCLUDED.owner_id
        AND ai_phone.aggregate_writer_leases.lease_until > now()
      THEN ai_phone.aggregate_writer_leases.fencing_token
      ELSE EXCLUDED.fencing_token
    END,
    lease_until = EXCLUDED.lease_until,
    updated_at = now()
  WHERE ai_phone.aggregate_writer_leases.lease_until <= now()
    OR ai_phone.aggregate_writer_leases.owner_id = target_owner
  RETURNING * INTO acquired;
  RETURN acquired;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('023_aggregate_lease_renewal')
ON CONFLICT (version) DO NOTHING;

COMMIT;
