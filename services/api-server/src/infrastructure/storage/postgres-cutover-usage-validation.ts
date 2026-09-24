import type {Pool} from "pg";

/** Confirm that migration 046 can renew an existing normalized hold without
 * changing its original session/idempotency identity or losing old records. */
export async function validateRenewableUsageHolds(pool:Pick<Pool,"query">){
  const definition=await pool.query<{definition:string|null}>(`
    SELECT pg_get_functiondef(
      'ai_phone.apply_usage_projection_event(text,text,text,text,jsonb)'::regprocedure
    ) AS definition
  `);
  const source=definition.rows[0]?.definition??"";
  const monotonic=source.includes("seconds = EXCLUDED.seconds")&&
    source.includes("expires_at = EXCLUDED.expires_at")&&
    source.includes("EXCLUDED.seconds >= ai_phone.usage_holds.seconds")&&
    source.includes("EXCLUDED.version = ai_phone.usage_holds.version + 1");
  const rows=await pool.query<{invalid_holds:string}>(`
    SELECT count(*) FILTER (WHERE primary_record.record_key IS NULL
      OR primary_record.payload->>'seconds' IS DISTINCT FROM hold.seconds::text
      OR (primary_record.payload->>'expiresAt')::timestamptz
        IS DISTINCT FROM hold.expires_at
    )::text AS invalid_holds
    FROM ai_phone.usage_holds AS hold
    LEFT JOIN ai_phone.projection_records AS primary_record
      ON primary_record.namespace='usageHolds' AND primary_record.record_key=hold.id
  `);
  const invalidHolds=Number(rows.rows[0]?.invalid_holds??-1);
  if(!monotonic||invalidHolds!==0)throw Error("PostgreSQL renewable usage hold validation failed");
  return {migration:"046_renewable_usage_holds",details:{monotonic,invalidHolds}};
}
