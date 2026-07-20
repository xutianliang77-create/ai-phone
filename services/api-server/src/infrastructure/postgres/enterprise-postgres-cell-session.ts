import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

export interface EnterpriseCellPostgresSession {
  readonly cellId: string;
  readonly workerId: string;
  readonly traceId: string;
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
  queryCoordination<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export async function withEnterpriseCellPostgresSession<T>(
  pool: EnterpriseTenantPostgresPool,
  input: { cellId: string; workerId: string; traceId: string },
  operation: (session: EnterpriseCellPostgresSession) => Promise<T>,
) {
  const cellId = requiredCellId(input.cellId);
  const workerId = requiredText("workerId", input.workerId, 128);
  const traceId = requiredText("traceId", input.traceId, 160);
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT set_config('app.cell_id', $1, true)",
      [cellId],
    );
    await client.query(
      "SELECT set_config('app.worker_id', $1, true)",
      [workerId],
    );
    await client.query(
      "SELECT set_config('app.trace_id', $1, true)",
      [traceId],
    );
    const session = Object.freeze({
      cellId,
      workerId,
      traceId,
      query<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertCellDiscoverySql(sql);
        return client.query<Row>(sql, [cellId, ...values]);
      },
      queryCoordination<Row extends Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) {
        assertCellCoordinationSql(sql);
        return client.query<Row>(sql, [cellId, ...values]);
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
        // Preserve the discovery error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function assertCellCoordinationSql(sql: string) {
  const normalized = normalizedSql(sql);
  const tableRefs = [...normalized.matchAll(
    /\benterprise\.([a-z_][a-z0-9_]*)\b/gi,
  )].map((match) => match[1]!.toLowerCase());
  const setClause = normalized.match(
    /\bupdate\s+enterprise\.platform_pending_work(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\s+([\s\S]*?)(?:\s+from\s+|\s+where\s+)/i,
  )?.[1];
  const assignments = setClause?.split(",").map((item) =>
    item.match(/^\s*(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*=/i)?.[1]
      ?.toLowerCase()
  ) ?? [];
  const allowed = new Set([
    "coordination_owner",
    "coordination_generation",
    "coordination_lease_expires_at",
  ]);
  const withClaim = /^with\b/i.test(normalized);
  const selectCount = normalized.match(/\bselect\b/gi)?.length ?? 0;
  if (
    !/\bupdate\s+enterprise\.platform_pending_work\b/i.test(normalized) ||
    tableRefs.length < 1 ||
    tableRefs.some((table) => table !== "platform_pending_work") ||
    !/\bcell_id\s*=\s*\$1\b/i.test(normalized) ||
    !/\breturning\b/i.test(normalized) ||
    /\b(?:insert|delete|alter|drop|truncate|grant|revoke|join|or|union)\b/i.test(normalized) ||
    normalized.includes(";") ||
    assignments.length < 1 ||
    assignments.some((column) => !column || !allowed.has(column)) ||
    new Set(assignments).size !== assignments.length ||
    (withClaim && (selectCount !== 1 ||
      !/\bfor\s+update\s+skip\s+locked\b/i.test(normalized))) ||
    (!withClaim && selectCount !== 0)
  ) {
    throw new Error(
      "Enterprise cell SQL must be a cell-scoped pending-work coordination update",
    );
  }
}

function assertCellDiscoverySql(sql: string) {
  const normalized = normalizedSql(sql);
  const tableRefs = [...normalized.matchAll(
    /\benterprise\.([a-z_][a-z0-9_]*)\b/gi,
  )].map((match) => match[1]!.toLowerCase());
  const fromCount = normalized.match(/\bfrom\b/gi)?.length ?? 0;
  const selectCount = normalized.match(/\bselect\b/gi)?.length ?? 0;
  const pendingFrom = normalized.match(
    /\bfrom\s+enterprise\.platform_pending_work\b([\s\S]*?)\bwhere\b/i,
  );
  const alias = pendingFrom?.[1]?.trim() ?? "";
  if (
    !/^select\b/i.test(normalized) ||
    selectCount !== 1 ||
    fromCount !== 1 ||
    !pendingFrom ||
    tableRefs.some((table) => table !== "platform_pending_work") ||
    (alias !== "" && !/^(?:as\s+)?[a-z_][a-z0-9_]*$/i.test(alias)) ||
    /\bjoin\b/i.test(normalized) ||
    /\b(?:or|union)\b/i.test(normalized) ||
    normalized.includes(";") ||
    !/\b(?:[a-z_][a-z0-9_]*\.)?cell_id\s*=\s*\$1\b/i.test(normalized)
  ) {
    throw new Error(
      "Enterprise cell SQL must be a cell-scoped pending-work SELECT",
    );
  }
}

function normalizedSql(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredCellId(value: string) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(cleaned)) {
    throw new Error("Invalid enterprise cellId");
  }
  return cleaned;
}

function requiredText(field: string, value: string, maxLength: number) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned || cleaned.length > maxLength) {
    throw new Error(`Invalid enterprise cell ${field}`);
  }
  return cleaned;
}
