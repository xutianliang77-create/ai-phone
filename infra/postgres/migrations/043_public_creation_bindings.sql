BEGIN;

-- PostgreSQL public creation persists the deterministic HTTP binding and the
-- first session record in one aggregate fence.  The generic projection record
-- is sufficient for this bounded metadata: it has no separate normalized
-- table, but must be admitted by the projection function before its durable
-- record can be written.
DO $repair$
DECLARE
  definition text;
  expected_fragment constant text := E'    ''agentCallDrafts''\n  ) THEN';
  replacement_fragment constant text :=
    E'    ''agentCallDrafts'', ''publicCreationBindings''\n  ) THEN';
BEGIN
  SELECT pg_get_functiondef(
    'ai_phone.apply_projection_event(text,text,text,text,jsonb)'::regprocedure
  ) INTO definition;
  IF position('''publicCreationBindings''' IN definition) = 0 THEN
    IF position(expected_fragment IN definition) = 0 THEN
      RAISE EXCEPTION 'Public creation binding projection function shape is unavailable';
    END IF;
    definition := replace(definition, expected_fragment, replacement_fragment);
    EXECUTE definition;
  END IF;
END;
$repair$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('043_public_creation_bindings')
ON CONFLICT (version) DO NOTHING;

COMMIT;
