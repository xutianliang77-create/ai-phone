import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";

export async function withEnterpriseAdmissionAdminSession<T>(input: {
  pool: EnterprisePostgresPool;
  cellId: string;
  operatorId: string;
  traceId: string;
  operation(session: {
    query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ): Promise<{ rows: Row[] }>;
  }): Promise<T>;
}) {
  const cellId = identifier("cell", input.cellId, 64);
  const operatorId = identifier("operator", input.operatorId, 128, true);
  const traceId = identifier("trace", input.traceId, 160, true);
  const client = await input.pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN");
    begun = true;
    await client.query("SELECT set_config('app.cell_id', $1, true)", [cellId]);
    await client.query(
      "SELECT set_config('app.admission_operator_id', $1, true)",
      [operatorId],
    );
    await client.query("SELECT set_config('app.trace_id', $1, true)", [traceId]);
    const result = await input.operation({
      query<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertAdminSql(sql);
        return client.query<Row>(sql, [cellId, operatorId, ...values]);
      },
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (begun) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const functions = new Set([
  "configure_cell_admission_policy",
  "configure_tenant_admission_weight",
  "cell_admission_status",
  "reconcile_cell_admission",
]);

function assertAdminSql(sql: string) {
  const normalized = sql.replace(/\s+/g, " ").trim();
  const name = normalized.match(
    /^select\b[\s\S]*\bfrom\s+enterprise\.([a-z_][a-z0-9_]*)\s*\(/i,
  )?.[1]?.toLowerCase();
  if (!name || !functions.has(name) || normalized.includes(";") ||
    /\b(?:join|union|insert|update|delete)\b/i.test(normalized) ||
    !/\(\s*\$1\s*,/.test(normalized) || !/\$2\b/.test(normalized)) {
    throw new Error("Enterprise admission admin SQL is outside the allowlist");
  }
}

function identifier(
  field: string,
  value: string,
  maximum: number,
  allowColon = false,
) {
  const cleaned = value?.trim() ?? "";
  const pattern = allowColon
    ? /^[A-Za-z0-9][A-Za-z0-9:_-]+$/
    : /^[A-Za-z0-9][A-Za-z0-9_-]+$/;
  if (!pattern.test(cleaned) || cleaned.length > maximum) {
    throw new Error(`Invalid enterprise admission ${field}`);
  }
  return cleaned;
}
