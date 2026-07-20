ALTER TABLE enterprise.platform_pending_work
  ADD COLUMN coordination_owner text,
  ADD COLUMN coordination_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN coordination_lease_expires_at timestamptz,
  ADD CONSTRAINT platform_pending_work_coordination_generation_check
    CHECK (coordination_generation >= 0),
  ADD CONSTRAINT platform_pending_work_coordination_owner_check CHECK (
    coordination_owner IS NULL OR
    coordination_owner ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'
  ),
  ADD CONSTRAINT platform_pending_work_coordination_lease_check CHECK (
    (coordination_owner IS NULL AND coordination_lease_expires_at IS NULL)
    OR (
      coordination_owner IS NOT NULL AND
      coordination_generation > 0 AND
      coordination_lease_expires_at IS NOT NULL
    )
  );

CREATE INDEX platform_pending_work_coordination_due_idx
  ON enterprise.platform_pending_work (
    cell_id, due_at, coordination_lease_expires_at,
    work_kind, tenant_id, resource_id
  )
  WHERE cell_id IS NOT NULL;

CREATE POLICY platform_pending_work_cell_claim
  ON enterprise.platform_pending_work
  FOR UPDATE
  USING (cell_id = enterprise.current_cell_id())
  WITH CHECK (cell_id = enterprise.current_cell_id());

CREATE OR REPLACE FUNCTION enterprise.guard_platform_pending_work_cell_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_worker text := NULLIF(current_setting('app.worker_id', true), '');
BEGIN
  IF enterprise.current_cell_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF current_worker IS NULL THEN
    RAISE EXCEPTION 'cell worker identity is required';
  END IF;

  IF NEW.cell_id IS DISTINCT FROM OLD.cell_id OR
      NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
      NEW.work_kind IS DISTINCT FROM OLD.work_kind OR
      NEW.resource_id IS DISTINCT FROM OLD.resource_id OR
      NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
      NEW.due_at IS DISTINCT FROM OLD.due_at OR
      NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at THEN
    RAISE EXCEPTION 'cell worker may only update coordination columns';
  END IF;

  IF NEW.coordination_owner IS NULL AND
      OLD.coordination_owner IS NOT NULL AND
      OLD.coordination_owner = current_worker AND
      NEW.coordination_generation = OLD.coordination_generation AND
      NEW.coordination_lease_expires_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.coordination_owner = OLD.coordination_owner AND
      NEW.coordination_owner = current_worker AND
      NEW.coordination_generation = OLD.coordination_generation AND
      NEW.coordination_lease_expires_at > OLD.coordination_lease_expires_at AND
      NEW.coordination_lease_expires_at <=
        clock_timestamp() + interval '5 minutes' AND
      OLD.coordination_lease_expires_at > clock_timestamp() THEN
    RETURN NEW;
  END IF;

  IF NEW.coordination_owner = current_worker AND
      NEW.coordination_generation = OLD.coordination_generation + 1 AND
      NEW.coordination_lease_expires_at > clock_timestamp() AND
      NEW.coordination_lease_expires_at <=
        clock_timestamp() + interval '5 minutes' AND
      COALESCE(
        OLD.coordination_lease_expires_at,
        '-infinity'::timestamptz
      ) <= clock_timestamp() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid cell worker coordination transition';
END
$$;

CREATE TRIGGER platform_pending_work_cell_claim_guard
BEFORE UPDATE ON enterprise.platform_pending_work
FOR EACH ROW
EXECUTE FUNCTION enterprise.guard_platform_pending_work_cell_claim();
