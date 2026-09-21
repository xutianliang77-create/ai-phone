import type { Pool } from "pg";

export async function validateAirDeviceMediaPolicy(pool: Pick<Pool, "query">) {
  const rows = await pool.query<{
    total: string;
    missing: string;
    unsupported: string;
  }>(`
    SELECT count(*)::text AS total,
      count(*) FILTER (WHERE media_policy IS NULL)::text AS missing,
      count(*) FILTER (
        WHERE media_policy NOT IN ('translation_isolated', 'agent_monitored')
      )::text AS unsupported
    FROM ai_phone.air_device_calls
  `);
  const constraint = await pool.query<{ validated: boolean }>(`
    SELECT convalidated AS validated
    FROM pg_constraint
    WHERE conname = 'air_device_calls_media_policy_check'
      AND conrelid = 'ai_phone.air_device_calls'::regclass
  `);
  const total = Number(rows.rows[0]?.total ?? -1);
  const missing = Number(rows.rows[0]?.missing ?? -1);
  const unsupported = Number(rows.rows[0]?.unsupported ?? -1);
  const constraintValidated = constraint.rows[0]?.validated === true;
  if (!Number.isSafeInteger(total) || total < 0 || missing !== 0 ||
    unsupported !== 0 || !constraintValidated) {
    throw new Error("PostgreSQL Air device media policy validation failed");
  }
  return {
    migration: "036_air_device_media_policy",
    details: { total, missing, unsupported, constraintValidated },
  };
}
