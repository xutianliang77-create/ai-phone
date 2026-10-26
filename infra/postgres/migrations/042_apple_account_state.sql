BEGIN;
-- Extend the deployed function instead of replacing it with migration 028's
-- historical body: retain the variable-conflict repair and all later fixes.
DO $upgrade$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'ai_phone.apply_product_record_projection_event(text,text,text,text,jsonb)'::regprocedure
  ) INTO definition;
  IF position('#variable_conflict use_column' IN definition) = 0 THEN
    RAISE EXCEPTION 'Apple metadata requires the existing projection compatibility repair';
  END IF;
  IF position('''appleAuthStates''' IN definition) = 0 THEN
    IF position('''voiceProfiles'') THEN' IN definition) = 0 OR
       position('WHEN ''accounts'' THEN event_payload->>''id''' IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected product projection function; review before migration';
    END IF;
    definition := replace(definition,
      '''voiceProfiles'') THEN', '''voiceProfiles'', ''appleAuthStates'') THEN');
    definition := replace(definition,
      'WHEN ''accounts'' THEN event_payload->>''id''',
      E'WHEN ''accounts'' THEN event_payload->>''id''\n    WHEN ''appleAuthStates'' THEN event_payload->>''ownerId''');
    EXECUTE definition;
  END IF;
END;
$upgrade$;
INSERT INTO ai_phone.schema_migrations(version)
VALUES ('042_apple_account_state') ON CONFLICT (version) DO NOTHING;
COMMIT;
