import type { Pool } from "pg";

export async function validateFractionalTranscriptTiming(pool: Pick<Pool, "query">) {
  const columns = await pool.query<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'ai_phone' AND table_name = 'transcript_segments'
      AND column_name IN ('start_ms', 'end_ms', 'latency_ms')
  `);
  const numericColumns = columns.rows.length === 3 &&
    new Set(columns.rows.map(row => row.column_name)).size === 3 &&
    columns.rows.every(row => row.data_type === "numeric");
  const source = await pool.query<{ definition: string }>(`
    SELECT pg_get_functiondef(
      'ai_phone.apply_projection_event(text,text,text,text,jsonb)'::regprocedure
    ) AS definition
  `);
  const definition = source.rows[0]?.definition ?? "";
  const fractionalProjection = [
    "NULLIF(segment#>>'{timing,startMs}', '')::numeric",
    "NULLIF(segment#>>'{timing,endMs}', '')::numeric",
    "NULLIF(segment->>'latencyMs', '')::numeric",
  ].every(fragment => definition.includes(fragment));
  if (!numericColumns || !fractionalProjection) {
    throw new Error("PostgreSQL fractional transcript timing schema validation failed");
  }
  const rows = await pool.query<{ timing_mismatches: string }>(`
    SELECT count(*)::text AS timing_mismatches
    FROM ai_phone.transcript_segments AS projected
    JOIN ai_phone.projection_records AS record
      ON record.namespace = 'sessions' AND record.record_key = projected.session_id
    JOIN LATERAL jsonb_array_elements(record.payload->'segments') AS segment
      ON segment->>'id' = projected.segment_id
      AND COALESCE((segment->>'revision')::integer, 1) = projected.revision
    WHERE projected.start_ms IS DISTINCT FROM NULLIF(segment#>>'{timing,startMs}', '')::numeric
      OR projected.end_ms IS DISTINCT FROM NULLIF(segment#>>'{timing,endMs}', '')::numeric
      OR projected.latency_ms IS DISTINCT FROM NULLIF(segment->>'latencyMs', '')::numeric
  `);
  const timingMismatches = Number(rows.rows[0]?.timing_mismatches ?? -1);
  if (timingMismatches !== 0) {
    throw new Error("PostgreSQL fractional transcript timing data validation failed");
  }
  return {
    migration: "045_fractional_transcript_timing",
    details: { numericColumns, fractionalProjection, timingMismatches },
  };
}
