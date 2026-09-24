import type {Pool} from "pg";

/** Validate the independently indexed attempt store before admitting a new
 * public candidate. Old session-embedded attempts remain readable. */
export async function validatePublicAttemptRecords(pool:Pick<Pool,"query">){
  const objects=await pool.query<{attempts_ready:boolean;index_ready:boolean;deletion_ready:boolean}>(`
    SELECT to_regclass('ai_phone.public_model_attempts') IS NOT NULL AS attempts_ready,
      to_regclass('ai_phone.public_model_attempts_session_idx') IS NOT NULL AS index_ready,
      EXISTS(SELECT 1 FROM pg_trigger
        WHERE tgname='delete_public_attempts_with_session'
          AND tgrelid='ai_phone.communication_sessions'::regclass
          AND NOT tgisinternal) AS deletion_ready
  `);
  const definition=await pool.query<{definition:string|null}>(`
    SELECT pg_get_functiondef(
      'ai_phone.apply_projection_event(text,text,text,text,jsonb)'::regprocedure
    ) AS definition
  `);
  const source=definition.rows[0]?.definition??"";
  const projectionReady=source.includes("'publicModelAttempts'")&&
    source.includes("INSERT INTO ai_phone.public_model_attempts")&&
    source.includes("EXCLUDED.version=ai_phone.public_model_attempts.version+1");
  const mismatch=await pool.query<{invalid_attempts:string}>(`
    SELECT count(*) FILTER (WHERE primary_record.record_key IS NULL
      OR primary_record.payload#>>'{event,attemptId}'
        IS DISTINCT FROM attempt.attempt_id
      OR primary_record.payload#>>'{event,sessionId}'
        IS DISTINCT FROM attempt.session_id
      OR (primary_record.payload->>'version')::bigint
        IS DISTINCT FROM attempt.version
    )::text AS invalid_attempts
    FROM ai_phone.public_model_attempts AS attempt
    LEFT JOIN ai_phone.projection_records AS primary_record
      ON primary_record.namespace='publicModelAttempts'
        AND primary_record.record_key=attempt.record_key
  `);
  const row=objects.rows[0],invalidAttempts=Number(mismatch.rows[0]?.invalid_attempts??-1);
  if(!row?.attempts_ready||!row.index_ready||!row.deletion_ready||
    !projectionReady||invalidAttempts!==0)throw Error("PostgreSQL public model attempt validation failed");
  return {migration:"047_public_model_attempt_records",details:{
    attemptsReady:true,indexReady:true,deletionReady:true,projectionReady:true,invalidAttempts,
  }};
}
