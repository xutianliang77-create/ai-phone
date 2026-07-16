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
  queryTenantRecord<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
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
      queryTenantRecord<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertTenantRecordSql(sql);
        return client.query<Row>(sql, [context.tenantId, ...values]);
      },
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
  const normalized = normalizedSql(sql);
  const tenantPredicate = /\btenant_id\s*=\s*\$1\b/i;
  if (!tenantPredicate.test(normalized) && !hasTenantInsert(normalized)) {
    throw new Error(
      "Enterprise tenant SQL must contain tenant_id = $1 or insert tenant_id as $1",
    );
  }
}

function assertTenantRecordSql(sql: string) {
  const normalized = normalizedSql(sql);
  const isSelect = /^select\b/i.test(normalized);
  const isUpdate = /^update\s+enterprise\.tenants\b/i.test(normalized);
  const isInsert = /^insert\s+into\s+enterprise\.tenants\b/i.test(normalized);
  if (!isSelect && !isUpdate && !isInsert) {
    throw new Error(
      "Enterprise tenant record SQL must target enterprise.tenants",
    );
  }
  const enterpriseTables = [...normalized.matchAll(
    /\benterprise\.([a-z_][a-z0-9_]*)\b/gi,
  )].map((match) => match[1]!.toLowerCase());
  if (!enterpriseTables.includes("tenants")) {
    throw new Error(
      "Enterprise tenant record SQL must target enterprise.tenants",
    );
  }
  if (
    enterpriseTables.some((table) => table !== "tenants") ||
    /\bjoin\b/i.test(normalized) ||
    /\b(?:or|union)\b/i.test(normalized) ||
    normalized.includes(";")
  ) {
    throw new Error("Enterprise tenant record SQL cannot join other tables");
  }
  if (isSelect) assertTenantRecordSelect(normalized);
  if (
    (isUpdate || isInsert) &&
    (/\bfrom\b/i.test(normalized) ||
      (normalized.match(/\bselect\b/gi)?.length ?? 0) > 0)
  ) {
    throw new Error("Enterprise tenant record SQL cannot join other tables");
  }
  if (isInsert) {
    const match = normalized.match(/\(([^)]*)\)\s*values\s*\(([^)]*)\)/i);
    const columns = match?.[1]?.split(",").map((value) => value.trim()) ?? [];
    const values = match?.[2]?.split(",").map((value) => value.trim()) ?? [];
    if (columns[0]?.toLowerCase() !== "id" || values[0] !== "$1") {
      throw new Error("Enterprise tenant record INSERT must use id = $1");
    }
    return;
  }
  if (!/\bwhere\b[\s\S]*\b(?:[a-z_][a-z0-9_]*\.)?id\s*=\s*\$1\b/i.test(
    normalized,
  )) {
    throw new Error("Enterprise tenant record SQL must contain id = $1");
  }
}

function assertTenantRecordSelect(normalized: string) {
  const fromCount = normalized.match(/\bfrom\b/gi)?.length ?? 0;
  const selectCount = normalized.match(/\bselect\b/gi)?.length ?? 0;
  const tenantFrom = normalized.match(
    /\bfrom\s+enterprise\.tenants\b([\s\S]*?)\bwhere\b/i,
  );
  const tenantAlias = tenantFrom?.[1]?.trim() ?? "";
  if (
    fromCount !== 1 ||
    selectCount !== 1 ||
    !tenantFrom ||
    (tenantAlias !== "" &&
      !/^(?:as\s+)?[a-z_][a-z0-9_]*$/i.test(tenantAlias))
  ) {
    throw new Error("Enterprise tenant record SQL cannot join other tables");
  }
}

function normalizedSql(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
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
