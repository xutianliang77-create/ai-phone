BEGIN;

DO $repair$
DECLARE
  target_name text;
  target_oid regprocedure;
  definition text;
  marker_position integer;
  marker constant text := E'AS $function$\n';
BEGIN
  FOREACH target_name IN ARRAY ARRAY[
    'apply_projection_event',
    'apply_agent_projection_event',
    'apply_agent_task_projection_event',
    'apply_agent_consult_projection_event',
    'apply_ingress_projection_event',
    'apply_recording_artifact_projection_event',
    'apply_recording_job_projection_event',
    'apply_usage_projection_event',
    'apply_billing_projection_event',
    'apply_product_record_projection_event'
  ] LOOP
    target_oid := to_regprocedure(
      'ai_phone.' || target_name || '(text,text,text,text,jsonb)'
    );
    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'Projection function is unavailable: %', target_name;
    END IF;
    SELECT pg_get_functiondef(target_oid) INTO definition;
    IF position('#variable_conflict use_column' IN definition) = 0 THEN
      marker_position := position(marker IN definition);
      IF marker_position = 0 THEN
        RAISE EXCEPTION 'Projection function body marker is unavailable: %', target_name;
      END IF;
      definition := overlay(
        definition placing marker || '#variable_conflict use_column' || E'\n'
        from marker_position for char_length(marker)
      );
      EXECUTE definition;
    END IF;
  END LOOP;
END;
$repair$;

ALTER TABLE ai_phone.transcript_segments
  DROP CONSTRAINT IF EXISTS transcript_segments_revision_check;
ALTER TABLE ai_phone.transcript_segments
  ADD CONSTRAINT transcript_segments_revision_check CHECK (revision >= 0);

CREATE OR REPLACE FUNCTION ai_phone.agent_task_projection_primary_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := COALESCE(NEW.version, 1);
  NEW.request_hash := COALESCE(
    NEW.request_hash,
    md5(NEW.id || ':' || NEW.user_id) || md5(NEW.created_at::text)
  );
  NEW.idempotency_key := COALESCE(
    NEW.idempotency_key,
    'projection:' || NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_task_projection_primary_defaults
  ON ai_phone.agent_tasks;
CREATE TRIGGER agent_task_projection_primary_defaults
BEFORE INSERT ON ai_phone.agent_tasks
FOR EACH ROW
EXECUTE FUNCTION ai_phone.agent_task_projection_primary_defaults();

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('029_projection_runtime_compatibility')
ON CONFLICT (version) DO NOTHING;

COMMIT;
