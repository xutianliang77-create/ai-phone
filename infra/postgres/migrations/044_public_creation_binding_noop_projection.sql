BEGIN;

-- 043 admitted the durable binding namespace.  This repair is intentionally
-- separate so databases that already applied its earlier form receive the two
-- no-op CASE branches as well.  Bindings have no normalized table; their
-- projection_records row is the durable state, so both paths must do nothing
-- before the generic record write/delete below the CASE statements.
DO $repair$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'ai_phone.apply_projection_event(text,text,text,text,jsonb)'::regprocedure
  ) INTO definition;
  IF position('''publicCreationBindings''' IN definition) = 0 THEN
    RAISE EXCEPTION 'Public creation binding projection namespace is unavailable';
  END IF;
  IF position(E'      WHEN ''publicCreationBindings'' THEN NULL;\n    END CASE;' IN definition) = 0 THEN
    IF position(E'      WHEN ''agentCallDrafts'' THEN DELETE FROM ai_phone.agent_tasks WHERE id = record_key;\n    END CASE;' IN definition) = 0 THEN
      RAISE EXCEPTION 'Public creation binding delete projection shape is unavailable';
    END IF;
    definition := replace(
      definition,
      E'      WHEN ''agentCallDrafts'' THEN DELETE FROM ai_phone.agent_tasks WHERE id = record_key;\n    END CASE;',
      E'      WHEN ''agentCallDrafts'' THEN DELETE FROM ai_phone.agent_tasks WHERE id = record_key;\n      WHEN ''publicCreationBindings'' THEN NULL;\n    END CASE;'
    );
  END IF;
  IF position(E'    WHEN ''publicCreationBindings'' THEN NULL;\n    WHEN ''sessions'' THEN' IN definition) = 0 THEN
    IF position(E'  CASE event_namespace\n    WHEN ''sessions'' THEN' IN definition) = 0 THEN
      RAISE EXCEPTION 'Public creation binding upsert projection shape is unavailable';
    END IF;
    definition := replace(
      definition,
      E'  CASE event_namespace\n    WHEN ''sessions'' THEN',
      E'  CASE event_namespace\n    WHEN ''publicCreationBindings'' THEN NULL;\n    WHEN ''sessions'' THEN'
    );
  END IF;
  EXECUTE definition;
END;
$repair$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('044_public_creation_binding_noop_projection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
