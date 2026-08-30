import type { EnterpriseControlPlanePool } from
  "./enterprise-control-plane-types.js";

export interface EnterpriseControlPlanePostgresSession {
  readonly workerId: string;
  readonly region: string;
  readonly traceId: string;
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export async function withEnterpriseControlPlanePostgresSession<T>(
  pool: EnterpriseControlPlanePool,
  input: { workerId: string; region: string; traceId: string },
  operation: (session: EnterpriseControlPlanePostgresSession) => Promise<T>,
) {
  const workerId = identifier("workerId", input.workerId);
  const region = regionId(input.region);
  const traceId = text("traceId", input.traceId, 160);
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT set_config('app.control_plane_worker_id', $1, true)",
      [workerId],
    );
    await client.query("SELECT set_config('app.trace_id', $1, true)", [traceId]);
    const session = Object.freeze({
      workerId,
      region,
      traceId,
      query<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertControlPlaneSql(sql);
        return client.query<Row>(sql, [workerId, region, ...values]);
      },
    });
    const result = await operation(session);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original database error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function assertControlPlaneSql(sql: string) {
  const normalized = sql.replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  const tables = [...normalized.matchAll(
    /\benterprise\.([a-z_][a-z0-9_]*)\b/gi,
  )].map((match) => match[1]!.toLowerCase());
  const allowed = new Set([
    "control_plane_instances",
    "control_plane_pending_work",
  ]);
  if (normalized.includes(";") || tables.length === 0 ||
    tables.some((table) => !allowed.has(table)) ||
    /\b(?:delete|alter|drop|truncate|grant|revoke|union)\b/i.test(normalized) ||
    !/^(?:select|insert|update|with)\b/i.test(normalized) ||
    !/\$1\b/.test(normalized) || !/\$2\b/.test(normalized)) {
    throw new Error("Enterprise control-plane SQL is outside the allowlist");
  }
}

function identifier(field: string, value: string) {
  const cleaned = value?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(cleaned)) {
    throw new Error(`Invalid enterprise control-plane ${field}`);
  }
  return cleaned;
}

function regionId(value: string) {
  const cleaned = value?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(cleaned)) {
    throw new Error("Invalid enterprise control-plane region");
  }
  return cleaned;
}

function text(field: string, value: string, maximum: number) {
  const cleaned = value?.trim() ?? "";
  if (!cleaned || cleaned.length > maximum) {
    throw new Error(`Invalid enterprise control-plane ${field}`);
  }
  return cleaned;
}
