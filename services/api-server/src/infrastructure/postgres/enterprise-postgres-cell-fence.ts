import type { EnterpriseCellQueryClient } from
  "./enterprise-postgres-cell-plan.js";

export interface EnterpriseCellWriterFence {
  sourceDefaultReadOnly: boolean;
  sourceWriteProbeRejected: boolean;
  sourceActiveWriterSessions: number;
  targetDefaultReadOnly: boolean;
  targetWriteProbeSucceeded: boolean;
  targetActiveWriterSessions: number;
  writerRoles: string[];
}

export async function enterpriseCellWriterFence(
  sourceClient: EnterpriseCellQueryClient,
  targetClient: EnterpriseCellQueryClient,
  writerRoles: string[],
): Promise<EnterpriseCellWriterFence> {
  assertWriterRoles(writerRoles);
  const [sourceDefaultReadOnly, sourceWriteProbeRejected,
    sourceActiveWriterSessions, targetDefaultReadOnly,
    targetWriteProbeRejected, targetActiveWriterSessions] = await Promise.all([
    defaultReadOnly(sourceClient), writeProbeRejected(sourceClient),
    writerSessions(sourceClient, writerRoles), defaultReadOnly(targetClient),
    writeProbeRejected(targetClient), writerSessions(targetClient, writerRoles),
  ]);
  return { sourceDefaultReadOnly, sourceWriteProbeRejected,
    sourceActiveWriterSessions, targetDefaultReadOnly,
    targetWriteProbeSucceeded: !targetWriteProbeRejected,
    targetActiveWriterSessions, writerRoles };
}

export function assertEnterpriseCellWriterFence(fence: EnterpriseCellWriterFence) {
  if (!fence.sourceDefaultReadOnly || !fence.sourceWriteProbeRejected ||
    fence.sourceActiveWriterSessions !== 0 || fence.targetDefaultReadOnly ||
    !fence.targetWriteProbeSucceeded || fence.targetActiveWriterSessions !== 0) {
    throw new Error("Enterprise cell writer fence is not established");
  }
}

async function defaultReadOnly(client: EnterpriseCellQueryClient) {
  const result = await client.query<{ value: string }>(
    "SELECT current_setting('default_transaction_read_only') AS value",
  );
  if (!result.rows[0] || !["on", "off"].includes(result.rows[0].value)) {
    throw new Error("Enterprise cell PostgreSQL read-only state is unavailable");
  }
  return result.rows[0].value === "on";
}

async function writeProbeRejected(client: EnterpriseCellQueryClient) {
  try {
    await client.query("UPDATE enterprise.tenants SET updated_at = updated_at WHERE false");
    return false;
  } catch (error) {
    if (isErrorCode(error, "25006")) return true;
    throw error;
  }
}

async function writerSessions(client: EnterpriseCellQueryClient, roles: string[]) {
  const result = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM pg_stat_activity
    WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()
  `, [roles]);
  const count = Number(result.rows[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Enterprise cell writer session count is invalid");
  }
  return count;
}

function assertWriterRoles(roles: string[]) {
  if (!roles.length || new Set(roles).size !== roles.length ||
    roles.some((role) => !/^[a-z_][a-z0-9_]{0,62}$/.test(role))) {
    throw new Error("Enterprise cell writer roles are invalid");
  }
}
function isErrorCode(error: unknown, code: string) {
  return error !== null && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === code;
}
