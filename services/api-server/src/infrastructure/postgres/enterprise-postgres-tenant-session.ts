import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";

export interface EnterpriseTenantPostgresClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
  release(): void;
}

export interface EnterpriseTenantPostgresPool {
  connect(): Promise<EnterpriseTenantPostgresClient>;
}

export interface EnterpriseTenantPostgresSession {
  readonly context: EnterpriseTenantContext;
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export async function withEnterpriseTenantPostgresSession<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (session: EnterpriseTenantPostgresSession) => Promise<T>,
) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [context.tenantId],
    );
    const session = Object.freeze({
      context,
      query<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertTenantScopedSql(sql);
        return client.query<Row>(sql, [context.tenantId, ...values]);
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
        // Preserve the repository error; the client is released below.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function assertTenantScopedSql(sql: string) {
  const normalized = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tenantPredicate = /\btenant_id\s*=\s*\$1\b/i;
  if (!tenantPredicate.test(normalized) && !hasTenantInsert(normalized)) {
    throw new Error(
      "Enterprise tenant SQL must contain tenant_id = $1 or insert tenant_id as $1",
    );
  }
}

function hasTenantInsert(sql: string) {
  if (!/^insert\b/i.test(sql)) return false;
  const match = sql.match(/\(([^)]*)\)\s*values\s*\(([^)]*)\)/i);
  if (!match) return false;
  const columns = match[1]!.split(",").map((value) => value.trim().toLowerCase());
  const values = match[2]!.split(",").map((value) => value.trim());
  const tenantIndex = columns.indexOf("tenant_id");
  return tenantIndex >= 0 && values[tenantIndex] === "$1";
}
