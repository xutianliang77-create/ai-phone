BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.air_devices (
  device_id text PRIMARY KEY,
  firmware_version text NOT NULL,
  protocol_version text NOT NULL,
  supported_sample_rates integer[] NOT NULL,
  status text NOT NULL CHECK (status IN (
    'ready', 'reserved', 'quarantined', 'offline', 'fault'
  )),
  last_heartbeat_at timestamptz NOT NULL,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(device_id) BETWEEN 1 AND 128),
  CHECK (cardinality(supported_sample_rates) BETWEEN 1 AND 2),
  CHECK (supported_sample_rates <@ ARRAY[8000, 16000])
);

CREATE INDEX IF NOT EXISTS air_devices_claim_idx
  ON ai_phone.air_devices(status, last_heartbeat_at, device_id);

CREATE TABLE IF NOT EXISTS ai_phone.air_device_leases (
  lease_id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES ai_phone.air_devices(device_id),
  communication_session_id text NOT NULL
    REFERENCES ai_phone.communication_sessions(id),
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  status text NOT NULL CHECK (status IN ('active', 'released', 'expired')),
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK (length(lease_id) BETWEEN 1 AND 128),
  CHECK (length(owner_id) BETWEEN 8 AND 200),
  UNIQUE(device_id, fencing_token),
  UNIQUE(device_id, lease_id, fencing_token)
);

CREATE UNIQUE INDEX IF NOT EXISTS air_device_leases_one_active_device_idx
  ON ai_phone.air_device_leases(device_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS air_device_leases_one_active_session_idx
  ON ai_phone.air_device_leases(communication_session_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS air_device_leases_expiry_idx
  ON ai_phone.air_device_leases(expires_at, lease_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ai_phone.air_device_calls (
  provider_call_id text PRIMARY KEY,
  communication_session_id text NOT NULL
    REFERENCES ai_phone.communication_sessions(id),
  provider_operation_id text NOT NULL UNIQUE
    REFERENCES ai_phone.provider_operations(id),
  device_id text NOT NULL REFERENCES ai_phone.air_devices(device_id),
  lease_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  room_name text NOT NULL,
  participant_identity text NOT NULL,
  carrier_state text NOT NULL CHECK (carrier_state IN (
    'dialing', 'ringing', 'connected', 'disconnected', 'busy', 'failed', 'unknown'
  )),
  livekit_participant_state text NOT NULL CHECK (livekit_participant_state IN (
    'absent', 'joining', 'joined', 'reconnecting', 'disconnected'
  )),
  call_generation bigint NOT NULL CHECK (call_generation >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(device_id, lease_id, fencing_token)
    REFERENCES ai_phone.air_device_leases(device_id, lease_id, fencing_token),
  CHECK (length(provider_call_id) BETWEEN 1 AND 200),
  CHECK (length(room_name) BETWEEN 1 AND 200),
  CHECK (length(participant_identity) BETWEEN 1 AND 240)
);

CREATE UNIQUE INDEX IF NOT EXISTS air_device_calls_one_active_device_idx
  ON ai_phone.air_device_calls(device_id)
  WHERE carrier_state IN ('dialing', 'ringing', 'connected', 'unknown');
CREATE INDEX IF NOT EXISTS air_device_calls_reconcile_idx
  ON ai_phone.air_device_calls(carrier_state, updated_at)
  WHERE carrier_state IN ('dialing', 'ringing', 'connected', 'unknown');

CREATE OR REPLACE FUNCTION ai_phone.claim_air_device(
  target_session_id text,
  target_lease_id text,
  target_owner_id text,
  target_ttl_seconds integer,
  heartbeat_freshness_seconds integer
) RETURNS SETOF ai_phone.air_device_leases
LANGUAGE plpgsql
AS $$
DECLARE
  selected_device ai_phone.air_devices;
  selected_lease ai_phone.air_device_leases;
BEGIN
  IF length(target_session_id) NOT BETWEEN 1 AND 160 OR
    length(target_lease_id) NOT BETWEEN 1 AND 128 OR
    length(target_owner_id) NOT BETWEEN 8 AND 200 OR
    target_ttl_seconds NOT BETWEEN 5 AND 300 OR
    heartbeat_freshness_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Invalid Air device lease claim';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('air-device-session:' || target_session_id, 0)
  );

  UPDATE ai_phone.air_devices AS device
  SET status = 'quarantined', version = device.version + 1, updated_at = now()
  WHERE device.device_id IN (
    SELECT lease.device_id FROM ai_phone.air_device_leases AS lease
    WHERE lease.status = 'active' AND lease.expires_at <= now()
  );
  UPDATE ai_phone.air_device_leases
  SET status = 'expired', version = version + 1, updated_at = now()
  WHERE status = 'active' AND expires_at <= now();

  SELECT * INTO selected_lease
  FROM ai_phone.air_device_leases
  WHERE communication_session_id = target_session_id
    AND status = 'active' AND expires_at > now()
  FOR UPDATE;
  IF FOUND THEN
    RETURN NEXT selected_lease;
    RETURN;
  END IF;

  SELECT * INTO selected_device
  FROM ai_phone.air_devices
  WHERE status = 'ready' AND last_heartbeat_at >
    now() - make_interval(secs => heartbeat_freshness_seconds)
  ORDER BY device_id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE ai_phone.air_devices
  SET status = 'reserved', fencing_token = fencing_token + 1,
    version = version + 1, updated_at = now()
  WHERE device_id = selected_device.device_id
  RETURNING * INTO selected_device;

  INSERT INTO ai_phone.air_device_leases(
    lease_id, device_id, communication_session_id, owner_id,
    fencing_token, status, expires_at
  ) VALUES (
    target_lease_id, selected_device.device_id, target_session_id,
    target_owner_id, selected_device.fencing_token, 'active',
    now() + make_interval(secs => target_ttl_seconds)
  ) RETURNING * INTO selected_lease;

  INSERT INTO ai_phone.reliable_outbox_events(
    id, idempotency_key, session_id, aggregate_version, sequence,
    event_type, event_version, payload
  ) VALUES (
    'air-lease-claimed-' || target_lease_id,
    'air-lease-claimed-' || target_lease_id,
    target_session_id, selected_lease.fencing_token,
    selected_lease.fencing_token, 'device.lease.claimed', 1,
    jsonb_build_object(
      'deviceId', selected_lease.device_id,
      'leaseId', selected_lease.lease_id,
      'fencingToken', selected_lease.fencing_token
    )
  ) ON CONFLICT(idempotency_key) DO NOTHING;

  RETURN NEXT selected_lease;
END;
$$;

CREATE OR REPLACE FUNCTION ai_phone.air_device_lease_is_current(
  target_device_id text,
  target_lease_id text,
  target_fencing_token bigint
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS(
    SELECT 1 FROM ai_phone.air_device_leases
    WHERE device_id = target_device_id AND lease_id = target_lease_id
      AND fencing_token = target_fencing_token AND status = 'active'
      AND expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION ai_phone.renew_air_device_lease(
  target_device_id text,
  target_lease_id text,
  target_fencing_token bigint,
  target_ttl_seconds integer
) RETURNS SETOF ai_phone.air_device_leases
LANGUAGE plpgsql
AS $$
DECLARE
  renewed ai_phone.air_device_leases;
BEGIN
  IF target_ttl_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Invalid Air device lease renewal';
  END IF;
  UPDATE ai_phone.air_device_leases
  SET expires_at = now() + make_interval(secs => target_ttl_seconds),
    version = version + 1, updated_at = now()
  WHERE device_id = target_device_id AND lease_id = target_lease_id
    AND fencing_token = target_fencing_token AND status = 'active'
    AND expires_at > now()
  RETURNING * INTO renewed;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT renewed;
END;
$$;

CREATE OR REPLACE FUNCTION ai_phone.release_air_device_lease(
  target_device_id text,
  target_lease_id text,
  target_fencing_token bigint,
  heartbeat_freshness_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  released ai_phone.air_device_leases;
BEGIN
  IF heartbeat_freshness_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Invalid Air device lease release';
  END IF;
  SELECT * INTO released FROM ai_phone.air_device_leases
  WHERE device_id = target_device_id AND lease_id = target_lease_id
    AND fencing_token = target_fencing_token AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE ai_phone.air_device_leases
  SET status = 'released', released_at = now(), updated_at = now(),
    version = version + 1
  WHERE lease_id = target_lease_id;
  UPDATE ai_phone.air_devices
  SET status = CASE WHEN last_heartbeat_at >
      now() - make_interval(secs => heartbeat_freshness_seconds)
    THEN 'ready' ELSE 'quarantined' END,
    version = version + 1, updated_at = now()
  WHERE device_id = target_device_id AND fencing_token = target_fencing_token;

  INSERT INTO ai_phone.reliable_outbox_events(
    id, idempotency_key, session_id, aggregate_version, sequence,
    event_type, event_version, payload
  ) VALUES (
    'air-lease-released-' || target_lease_id,
    'air-lease-released-' || target_lease_id,
    released.communication_session_id, released.fencing_token,
    released.fencing_token, 'device.lease.released', 1,
    jsonb_build_object(
      'deviceId', released.device_id,
      'leaseId', released.lease_id,
      'fencingToken', released.fencing_token
    )
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('032_air_device_call_control')
ON CONFLICT (version) DO NOTHING;

COMMIT;
