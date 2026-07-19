CREATE TABLE enterprise.meeting_calendar_syncs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'google_calendar'),
  status text NOT NULL CHECK (status IN ('pending', 'synced', 'failed')),
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  provider_event_key text NOT NULL CHECK (
    provider_event_key ~ '^[a-v0-9]{5,64}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  outbox_event_id uuid NOT NULL,
  provider_event_id text CHECK (
    provider_event_id IS NULL OR length(provider_event_id) BETWEEN 1 AND 1024
  ),
  provider_event_etag text CHECK (
    provider_event_etag IS NULL OR length(provider_event_etag) BETWEEN 1 AND 512
  ),
  provider_web_url text CHECK (
    provider_web_url IS NULL OR
    (length(provider_web_url) BETWEEN 9 AND 2048 AND provider_web_url ~ '^https://')
  ),
  provider_response_hash text CHECK (
    provider_response_hash IS NULL OR provider_response_hash ~ '^[a-f0-9]{64}$'
  ),
  attempts integer NOT NULL CHECK (attempts >= 0),
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  synced_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, meeting_id, provider),
  UNIQUE (tenant_id, meeting_id, idempotency_key),
  UNIQUE (tenant_id, provider, provider_event_key),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, outbox_event_id)
    REFERENCES enterprise.outbox_events (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK (updated_at >= created_at),
  CHECK (synced_at IS NULL OR synced_at >= created_at),
  CHECK (
    (status = 'pending' AND provider_event_id IS NULL AND
      provider_event_etag IS NULL AND provider_web_url IS NULL AND
      provider_response_hash IS NULL AND synced_at IS NULL) OR
    (status = 'synced' AND provider_event_id IS NOT NULL AND
      provider_event_etag IS NOT NULL AND provider_web_url IS NOT NULL AND
      provider_response_hash IS NOT NULL AND last_error_code IS NULL AND
      synced_at IS NOT NULL) OR
    (status = 'failed' AND provider_event_id IS NULL AND
      provider_event_etag IS NULL AND provider_web_url IS NULL AND
      provider_response_hash IS NULL AND last_error_code IS NOT NULL AND
      synced_at IS NULL)
  )
);

CREATE INDEX meeting_calendar_syncs_status_idx
  ON enterprise.meeting_calendar_syncs (
    tenant_id, status, updated_at DESC, meeting_id, id
  );

CREATE OR REPLACE FUNCTION enterprise.guard_meeting_calendar_sync_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise meeting calendar sync cannot be deleted';
  END IF;
  IF ROW(
    NEW.tenant_id, NEW.id, NEW.meeting_id, NEW.provider,
    NEW.scheduled_start_at, NEW.scheduled_end_at, NEW.provider_event_key,
    NEW.request_hash, NEW.idempotency_key, NEW.outbox_event_id,
    NEW.created_by, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.tenant_id, OLD.id, OLD.meeting_id, OLD.provider,
    OLD.scheduled_start_at, OLD.scheduled_end_at, OLD.provider_event_key,
    OLD.request_hash, OLD.idempotency_key, OLD.outbox_event_id,
    OLD.created_by, OLD.created_at
  ) OR NEW.version <> OLD.version + 1 OR OLD.status <> 'pending' OR
    NEW.status NOT IN ('pending', 'synced', 'failed') THEN
    RAISE EXCEPTION 'invalid enterprise meeting calendar sync transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_calendar_syncs_guard
BEFORE UPDATE OR DELETE ON enterprise.meeting_calendar_syncs
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_meeting_calendar_sync_mutation();

ALTER TABLE enterprise.meeting_calendar_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.meeting_calendar_syncs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise.meeting_calendar_syncs
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
