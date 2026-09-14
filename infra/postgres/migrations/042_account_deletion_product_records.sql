BEGIN;

/*
 * Public 1.1 account deletion needs physical removal after its approved
 * retention window. Product records previously supported append/update only;
 * this preserves the idempotent projection inbox while removing both index and
 * primary payload on an explicit delete event.
 */
CREATE OR REPLACE FUNCTION ai_phone.apply_product_record_projection_event(
  event_id text,
  event_namespace text,
  record_key text,
  event_operation text,
  event_payload jsonb
) RETURNS boolean
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  inserted boolean;
  owner_id_value text;
  lookup_key_value text;
  status_value text;
  kind_value text;
  flag_value boolean;
  created_value timestamptz;
  updated_value timestamptz;
BEGIN
  IF event_namespace NOT IN ('accounts', 'authSessions', 'smsOtpChallenges',
    'accountConsents', 'appErrorReports', 'termbaseTerms', 'voiceIdentities',
    'voiceProfiles') THEN
    RAISE EXCEPTION 'Unsupported product record namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported product record projection operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Product record upsert requires payload';
  END IF;

  INSERT INTO ai_phone.postgres_projection_inbox(
    event_id, namespace, record_key, operation, payload_hash
  ) VALUES (
    event_id, event_namespace, record_key, event_operation,
    md5(COALESCE(event_payload, 'null'::jsonb)::text)
  ) ON CONFLICT (event_id) DO NOTHING
  RETURNING true INTO inserted;
  IF NOT COALESCE(inserted, false) THEN RETURN false; END IF;

  IF event_operation = 'delete' THEN
    DELETE FROM ai_phone.product_records
    WHERE namespace = event_namespace AND record_key = apply_product_record_projection_event.record_key;
    RETURN true;
  END IF;

  owner_id_value := CASE event_namespace
    WHEN 'accounts' THEN event_payload->>'id'
    WHEN 'smsOtpChallenges' THEN event_payload->>'phoneHash'
    WHEN 'appErrorReports' THEN COALESCE(event_payload->>'userId', 'global')
    ELSE event_payload->>'userId'
  END;
  lookup_key_value := CASE event_namespace
    WHEN 'accounts' THEN event_payload->>'phoneHash'
    WHEN 'authSessions' THEN event_payload->>'tokenHash'
    WHEN 'smsOtpChallenges' THEN event_payload->>'phoneHash'
    WHEN 'accountConsents' THEN concat_ws(':', event_payload->>'consentType',
      event_payload->>'version', event_payload->>'scene')
    WHEN 'termbaseTerms' THEN concat_ws(':', event_payload->>'termbaseId',
      lower(event_payload->>'sourceText'), event_payload->>'targetLanguage')
    ELSE NULL
  END;
  status_value := CASE event_namespace
    WHEN 'authSessions' THEN CASE WHEN event_payload ? 'revokedAt' THEN 'revoked' ELSE 'active' END
    WHEN 'smsOtpChallenges' THEN CASE
      WHEN event_payload ? 'consumedAt' THEN 'consumed'
      WHEN event_payload ? 'supersededAt' THEN 'superseded'
      WHEN event_payload ? 'lockedAt' THEN 'locked'
      ELSE 'active' END
    WHEN 'appErrorReports' THEN event_payload->>'platform'
    ELSE event_payload->>'status'
  END;
  kind_value := CASE event_namespace
    WHEN 'accountConsents' THEN event_payload->>'consentType'
    WHEN 'appErrorReports' THEN event_payload->>'eventType'
    ELSE NULL
  END;
  flag_value := CASE WHEN event_namespace = 'appErrorReports'
    THEN COALESCE((event_payload->>'fatal')::boolean, false) ELSE NULL END;
  created_value := COALESCE(
    NULLIF(event_payload->>'createdAt', '')::timestamptz,
    NULLIF(event_payload->>'recordedAt', '')::timestamptz,
    NULLIF(event_payload->>'receivedAt', '')::timestamptz,
    now()
  );
  updated_value := COALESCE(
    NULLIF(event_payload->>'updatedAt', '')::timestamptz,
    NULLIF(event_payload->>'recordedAt', '')::timestamptz,
    NULLIF(event_payload->>'receivedAt', '')::timestamptz,
    created_value
  );

  INSERT INTO ai_phone.product_records(
    namespace, record_key, owner_id, lookup_key, status, kind, flag,
    created_at, updated_at
  ) VALUES (
    event_namespace, record_key, owner_id_value, lookup_key_value,
    status_value, kind_value, flag_value, created_value, updated_value
  ) ON CONFLICT (namespace, record_key) DO UPDATE SET
    owner_id = EXCLUDED.owner_id,
    lookup_key = EXCLUDED.lookup_key,
    status = EXCLUDED.status,
    kind = EXCLUDED.kind,
    flag = EXCLUDED.flag,
    updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$function$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('042_account_deletion_product_records')
ON CONFLICT (version) DO NOTHING;

COMMIT;
