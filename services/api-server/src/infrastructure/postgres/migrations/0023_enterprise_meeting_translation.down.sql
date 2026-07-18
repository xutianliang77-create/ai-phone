DROP TABLE IF EXISTS enterprise.meeting_translation_events;
DROP FUNCTION IF EXISTS enterprise.reject_meeting_translation_event_mutation();

ALTER TABLE enterprise.worker_dispatch_grants
  DROP CONSTRAINT IF EXISTS worker_dispatch_grants_session_id_key;

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.dispatch_id,
    NEW.capacity_reservation_id, NEW.capability, NEW.cell_id,
    NEW.route_epoch, NEW.generation, NEW.policy_snapshot_id,
    NEW.policy_version, NEW.billing_account_id, NEW.entitlement_version,
    NEW.idempotency_key, NEW.request_hash, NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.dispatch_id,
    OLD.capacity_reservation_id, OLD.capability, OLD.cell_id,
    OLD.route_epoch, OLD.generation, OLD.policy_snapshot_id,
    OLD.policy_version, OLD.billing_account_id, OLD.entitlement_version,
    OLD.idempotency_key, OLD.request_hash, OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch grant identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE enterprise.meeting_participants
  DROP CONSTRAINT IF EXISTS meeting_participants_translation_scope_key,
  DROP CONSTRAINT IF EXISTS meeting_participants_playback_generation_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_caption_language_check,
  DROP COLUMN IF EXISTS playback_generation,
  DROP COLUMN IF EXISTS translated_audio_enabled,
  DROP COLUMN IF EXISTS caption_language;
