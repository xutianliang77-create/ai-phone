import {
  collectEnterpriseCellManifestInTransaction,
  compareEnterpriseCellManifests,
  discoverEnterpriseCellTables,
  forEachEnterpriseCellPage,
  type EnterpriseCellDataManifest,
  type EnterpriseCellQueryClient,
  type EnterpriseCellTablePlan,
} from "./enterprise-postgres-cell-manifest.js";
import { stableEnterpriseCutoverJson as stableJson } from
  "./enterprise-postgres-database-manifest.js";
import {
  assertEnterpriseCellWriterFence,
  enterpriseCellWriterFence,
  type EnterpriseCellWriterFence,
} from "./enterprise-postgres-cell-fence.js";
export { enterpriseCellWriterFence } from "./enterprise-postgres-cell-fence.js";
import {
  prepareEnterpriseCellRollbackTarget,
  restoreEnterpriseCellRollbackTriggers,
} from "./enterprise-postgres-cell-rollback.js";

export interface EnterpriseCellTransferResult {
  source: EnterpriseCellDataManifest;
  target: EnterpriseCellDataManifest;
  comparison: ReturnType<typeof compareEnterpriseCellManifests>;
  writerFence: EnterpriseCellWriterFence;
}
export async function exportEnterpriseTenantCell(
  client: EnterpriseCellQueryClient,
  input: { tenantId: string; logicalId: string; expectedCellId: string },
) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await configureSnapshot(client, input.tenantId);
    await assertTenantQuiescent(client, input.tenantId);
    const plan = await discoverEnterpriseCellTables(client);
    const manifest = await collectEnterpriseCellManifestInTransaction(
      client, plan, input.tenantId, input.logicalId,
    );
    assertRoute(manifest, input.expectedCellId);
    await client.query("COMMIT");
    return manifest;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
export async function transferEnterpriseTenantCell(
  sourceClient: EnterpriseCellQueryClient,
  targetClient: EnterpriseCellQueryClient,
  input: {
    tenantId: string;
    sourceLogicalId: string;
    targetLogicalId: string;
    sourceCellId: string;
    targetCellId: string;
    writerRoles: string[];
    replaceTarget?: boolean;
    changedAt?: string;
    expectedTargetDatabase?: { oid: string; systemIdentifier: string };
  },
): Promise<EnterpriseCellTransferResult> {
  if (input.sourceCellId === input.targetCellId) {
    throw new Error("Enterprise cell source and target cells must differ");
  }
  const writerFence = await enterpriseCellWriterFence(
    sourceClient, targetClient, input.writerRoles,
  );
  assertEnterpriseCellWriterFence(writerFence);
  await sourceClient.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let sourceOpen = true;
  let targetOpen = false;
  try {
    await configureSnapshot(sourceClient, input.tenantId);
    await assertTenantQuiescent(sourceClient, input.tenantId);
    const sourcePlan = await discoverEnterpriseCellTables(sourceClient);
    const source = await collectEnterpriseCellManifestInTransaction(
      sourceClient, sourcePlan, input.tenantId, input.sourceLogicalId,
    );
    assertRoute(source, input.sourceCellId);

    await targetClient.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    targetOpen = true;
    await configureTarget(targetClient, input.tenantId);
    const targetPlan = await discoverEnterpriseCellTables(targetClient);
    assertPlansMatch(sourcePlan, targetPlan);
    await assertTargetContract(
      targetClient, source, input.expectedTargetDatabase,
    );
    await targetClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 5005))",
      [input.tenantId],
    );
    if (input.replaceTarget) {
      await prepareEnterpriseCellRollbackTarget(
        targetClient, targetPlan, input.tenantId,
      );
    } else {
      await assertTargetEmpty(targetClient, input.tenantId);
    }
    const changedAt = normalizedTimestamp(input.changedAt ?? new Date().toISOString());
    await importTenant(sourceClient, targetClient, sourcePlan, input.tenantId,
      input.targetCellId, changedAt, Boolean(input.replaceTarget));
    if (input.replaceTarget) {
      await restoreEnterpriseCellRollbackTriggers(targetClient, targetPlan);
    }
    const target = await collectEnterpriseCellManifestInTransaction(
      targetClient, targetPlan, input.tenantId, input.targetLogicalId,
    );
    assertRoute(target, input.targetCellId);
    if (target.route.version !== source.route.version + 1) {
      throw new Error("Enterprise cell route epoch did not advance exactly once");
    }
    const comparison = compareEnterpriseCellManifests(source, target);
    if (comparison.status !== "matched") {
      throw new Error(
        `Enterprise cell reconcile mismatch: ${comparison.mismatchedTables.join(",")}`,
      );
    }
    await sourceClient.query("COMMIT");
    sourceOpen = false;
    await targetClient.query("COMMIT");
    targetOpen = false;
    return { source, target, comparison, writerFence };
  } catch (error) {
    if (targetOpen) await targetClient.query("ROLLBACK").catch(() => undefined);
    if (sourceOpen) await sourceClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
export async function reconcileEnterpriseTenantCell(
  sourceClient: EnterpriseCellQueryClient,
  targetClient: EnterpriseCellQueryClient,
  input: { tenantId: string; sourceLogicalId: string; targetLogicalId: string },
) {
  await sourceClient.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await targetClient.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await configureSnapshot(sourceClient, input.tenantId);
    await configureSnapshot(targetClient, input.tenantId);
    const sourcePlan = await discoverEnterpriseCellTables(sourceClient);
    const targetPlan = await discoverEnterpriseCellTables(targetClient);
    assertPlansMatch(sourcePlan, targetPlan);
    const [source, target] = await Promise.all([
      collectEnterpriseCellManifestInTransaction(
        sourceClient, sourcePlan, input.tenantId, input.sourceLogicalId,
      ),
      collectEnterpriseCellManifestInTransaction(
        targetClient, targetPlan, input.tenantId, input.targetLogicalId,
      ),
    ]);
    const comparison = compareEnterpriseCellManifests(source, target);
    if (comparison.status !== "matched") {
      throw new Error(
        `Enterprise cell reconcile mismatch: ${comparison.mismatchedTables.join(",")}`,
      );
    }
    await sourceClient.query("COMMIT");
    await targetClient.query("COMMIT");
    return { source, target, comparison };
  } catch (error) {
    await Promise.all([
      sourceClient.query("ROLLBACK").catch(() => undefined),
      targetClient.query("ROLLBACK").catch(() => undefined),
    ]);
    throw error;
  }
}

async function importTenant(
  source: EnterpriseCellQueryClient,
  target: EnterpriseCellQueryClient,
  plan: EnterpriseCellTablePlan[],
  tenantId: string,
  targetCellId: string,
  changedAt: string,
  importDerived: boolean,
) {
  for (const table of plan) {
    if (table.derived && !importDerived) continue;
    await forEachEnterpriseCellPage(source, table, tenantId, 500, async (records) => {
      if (!records.length) return;
      const transform = table.name === "enterprise.tenants" ||
        table.name === "enterprise.platform_pending_work";
      const payload = transform
        ? JSON.stringify(records.map((record) => targetRecord(
          table.name, record.value, targetCellId, changedAt,
        )))
        : `[${records.map((record) => record.json).join(",")}]`;
      const columns = table.insertColumns.map(quote);
      await target.query(`
        INSERT INTO ${quote(table.schema)}.${quote(table.table)} (${columns.join(", ")})
        SELECT ${columns.join(", ")} FROM jsonb_populate_recordset(
          NULL::${quote(table.schema)}.${quote(table.table)}, $1::jsonb
        )
      `, [payload]);
    });
  }
}
async function assertTargetEmpty(client: EnterpriseCellQueryClient, tenantId: string) {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM enterprise.tenants WHERE id = $1::uuid) AS exists",
    [tenantId],
  );
  if (result.rows[0]?.exists) {
    throw new Error("Enterprise cell migration target tenant is not empty");
  }
}

async function assertTenantQuiescent(
  client: EnterpriseCellQueryClient,
  tenantId: string,
) {
  const result = await client.query<{ busy: boolean }>(`
    SELECT
      EXISTS(SELECT 1 FROM enterprise.communication_session_bindings
        WHERE tenant_id = $1::uuid
          AND status NOT IN ('ended', 'cancelled', 'failed'))
      OR EXISTS(SELECT 1 FROM enterprise.worker_dispatch_grants
        WHERE tenant_id = $1::uuid AND status IN ('issued', 'accepted'))
      OR EXISTS(SELECT 1 FROM enterprise.platform_pending_work
        WHERE tenant_id = $1::uuid AND (
          lease_expires_at > clock_timestamp() OR
          coordination_lease_expires_at > clock_timestamp()
        ))
      OR EXISTS(SELECT 1 FROM enterprise.control_plane_pending_work
        WHERE tenant_id = $1::uuid
          AND coordination_lease_expires_at > clock_timestamp())
      OR EXISTS(SELECT 1 FROM ai_phone.worker_dispatches
        WHERE scope_type = 'tenant' AND scope_id = $1
          AND status IN ('reserved', 'dispatching', 'dispatched', 'ready', 'draining'))
      OR EXISTS(SELECT 1 FROM ai_phone.worker_capacity_reservations
        WHERE scope_type = 'tenant' AND scope_id = $1
          AND status = 'held' AND lease_expires_at > clock_timestamp()) AS busy
  `, [tenantId]);
  if (result.rows[0]?.busy) {
    throw new Error("Enterprise cell tenant still has active sessions or leases");
  }
}

async function assertTargetContract(
  client: EnterpriseCellQueryClient,
  source: EnterpriseCellDataManifest,
  expectedDatabase?: { oid: string; systemIdentifier: string },
) {
  const publicResult = await client.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const enterpriseResult = await client.query<{ id: string; checksum: string }>(
    "SELECT id, checksum FROM enterprise.schema_migrations ORDER BY id",
  );
  const identityResult = await client.query<{ version: string; oid: string;
    system_identifier: string }>(`
    SELECT current_setting('server_version_num') AS version,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
      (pg_control_system()).system_identifier::text AS system_identifier
  `);
  const identity = identityResult.rows[0];
  if (stableJson(publicResult.rows.map((row) => row.version)) !==
      stableJson(source.publicMigrations) ||
    stableJson(enterpriseResult.rows) !== stableJson(source.enterpriseMigrations) ||
    identity?.version !== source.database.serverVersionNum) {
    throw new Error("Enterprise cell source and target database contracts differ");
  }
  if (identity.oid === source.database.oid &&
    identity.system_identifier === source.database.systemIdentifier) {
    throw new Error("Enterprise cell source and target databases are identical");
  }
  if (expectedDatabase && (identity.oid !== expectedDatabase.oid ||
    identity.system_identifier !== expectedDatabase.systemIdentifier)) {
    throw new Error("Enterprise cell rollback target database identity changed");
  }
}

function assertPlansMatch(
  source: EnterpriseCellTablePlan[],
  target: EnterpriseCellTablePlan[],
) {
  const shape = (plan: EnterpriseCellTablePlan[]) => plan.map((table) => ({
    name: table.name, primaryKey: table.primaryKey,
    insertColumns: table.insertColumns,
    dependencies: [...table.dependencies].sort(), selector: table.selector,
  }));
  if (stableJson(shape(source)) !== stableJson(shape(target))) {
    throw new Error("Enterprise cell source and target table plans differ");
  }
}

function targetRecord(
  table: string,
  record: Record<string, unknown>,
  targetCellId: string,
  changedAt: string,
) {
  const result = structuredClone(record);
  if (table === "enterprise.tenants") {
    const version = Number(result.version);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Enterprise cell tenant route version is invalid");
    }
    result.cell_id = targetCellId;
    result.version = version + 1;
    result.updated_at = changedAt;
  } else if (table === "enterprise.platform_pending_work") {
    result.cell_id = targetCellId;
    result.coordination_owner = null;
    result.coordination_lease_expires_at = null;
  }
  return result;
}

async function configureSnapshot(client: EnterpriseCellQueryClient, tenantId: string) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('app.scope_type', 'tenant', true)");
  await client.query("SELECT set_config('app.scope_id', $1, true)", [tenantId]);
}
async function configureTarget(client: EnterpriseCellQueryClient, tenantId: string) {
  await configureSnapshot(client, tenantId);
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

function assertRoute(manifest: EnterpriseCellDataManifest, cellId: string) {
  if (manifest.route.cellId !== cellId) {
    throw new Error("Enterprise cell tenant route does not match the expected source cell");
  }
}
function quote(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Invalid cell transfer identifier");
  return `"${value}"`;
}
function normalizedTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Enterprise cell change time is invalid");
  return parsed.toISOString();
}
