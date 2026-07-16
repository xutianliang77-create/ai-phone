import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";

export interface EnterpriseDirectoryPostgresSession {
  readonly userId: string;
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export async function withEnterpriseDirectoryPostgresSession<T>(
  pool: EnterpriseTenantPostgresPool,
  userId: string,
  operation: (session: EnterpriseDirectoryPostgresSession) => Promise<T>,
) {
  const cleanedUserId = requiredUserId(userId);
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT set_config('app.user_id', $1, true)",
      [cleanedUserId],
    );
    const session = Object.freeze({
      userId: cleanedUserId,
      query<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertDirectorySql(sql);
        return client.query<Row>(sql, [cleanedUserId, ...values]);
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
        // Preserve the repository error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function assertDirectorySql(sql: string) {
  const normalized = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tableRefs = [...normalized.matchAll(
    /\benterprise\.([a-z_][a-z0-9_]*)\b/gi,
  )].map((match) => match[1]!.toLowerCase());
  const fromCount = normalized.match(/\bfrom\b/gi)?.length ?? 0;
  const directoryFrom = normalized.match(
    /\bfrom\s+enterprise\.user_tenant_directory\b([\s\S]*?)\bwhere\b/i,
  );
  const alias = directoryFrom?.[1]?.trim() ?? "";
  const selectCount = normalized.match(/\bselect\b/gi)?.length ?? 0;
  if (
    !/^select\b/i.test(normalized) ||
    selectCount !== 1 ||
    tableRefs.some((table) => table !== "user_tenant_directory") ||
    fromCount !== 1 ||
    !directoryFrom ||
    (alias !== "" && !/^(?:as\s+)?[a-z_][a-z0-9_]*$/i.test(alias)) ||
    /\bjoin\b/i.test(normalized) ||
    /\b(?:or|union)\b/i.test(normalized) ||
    normalized.includes(";") ||
    !/\b(?:[a-z_][a-z0-9_]*\.)?user_id\s*=\s*\$1\b/i.test(normalized)
  ) {
    throw new Error(
      "Enterprise directory SQL must be a self-scoped directory SELECT",
    );
  }
}

function requiredUserId(value: string) {
  return enterprisePostgresAccountSubjectId(value);
}
