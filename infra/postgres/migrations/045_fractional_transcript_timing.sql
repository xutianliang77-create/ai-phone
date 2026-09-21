BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- The shared segment contract accepts finite fractional milliseconds. Preserve
-- that precision in the query projection, just as projection_records already
-- preserves it in JSON. Never round audio watermarks or change billing units.
ALTER TABLE ai_phone.transcript_segments
  ALTER COLUMN start_ms TYPE numeric USING start_ms::numeric,
  ALTER COLUMN end_ms TYPE numeric USING end_ms::numeric,
  ALTER COLUMN latency_ms TYPE numeric USING latency_ms::numeric;

-- Keep all previous namespace/fencing/idempotency repairs. Old migrations are
-- immutable; patch only the three numeric conversions in the installed body.
DO $repair$
DECLARE
  definition text;
  original text;
  replacement text;
  originals constant text[] := ARRAY[
    'NULLIF(segment#>>''{timing,startMs}'', '''')::bigint',
    'NULLIF(segment#>>''{timing,endMs}'', '''')::bigint',
    'NULLIF(segment->>''latencyMs'', '''')::integer'
  ];
BEGIN
  SELECT pg_get_functiondef(
    'ai_phone.apply_projection_event(text,text,text,text,jsonb)'::regprocedure
  ) INTO definition;
  FOREACH original IN ARRAY originals LOOP
    replacement := regexp_replace(original, '::(bigint|integer)$', '::numeric');
    IF position(original IN definition) > 0 THEN
      definition := replace(definition, original, replacement);
    ELSIF position(replacement IN definition) = 0 THEN
      RAISE EXCEPTION 'Transcript timing projection shape is unavailable: %', original;
    END IF;
  END LOOP;
  EXECUTE definition;
END;
$repair$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('045_fractional_transcript_timing')
ON CONFLICT (version) DO NOTHING;

COMMIT;
