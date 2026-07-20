import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  createEnterprisePostgresClient,
  enterprisePostgresSslConfig,
  type EnterprisePostgresClient,
} from "./enterprise-postgres-client.js";
import {
  assertEnterpriseCellObjectReceipt,
  enterpriseCellMigrationMetadata,
  enterpriseCellMigrationSigningKey,
  enterpriseCellObjectReceiptSigningKey,
  readEnterpriseCellMigrationEvidence,
  readEnterpriseCellObjectReceipt,
  writeEnterpriseCellMigrationEvidence,
  type EnterpriseCellMigrationMetadata,
  type EnterpriseCellObjectReceipt,
} from "./enterprise-postgres-cell-evidence.js";
import {
  enterpriseCellWriterFence,
  exportEnterpriseTenantCell,
  transferEnterpriseTenantCell,
} from "./enterprise-postgres-cell-transfer.js";
import { attestEnterpriseCellMigration } from
  "./enterprise-postgres-cell-attest.js";
type Command = "export" | "cutover" | "reconcile" | "rollback";
async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command || !["export", "cutover", "reconcile", "rollback"].includes(command)) {
    throw new Error(
      "Usage: enterprise:postgres-cell export|cutover|reconcile|rollback",
    );
  }
  const env = process.env;
  if (env.ENTERPRISE_CELL_MIGRATION_MAINTENANCE !== "true") {
    throw new Error(
      "Set ENTERPRISE_CELL_MIGRATION_MAINTENANCE=true after API and workers are stopped",
    );
  }
  const metadata = enterpriseCellMigrationMetadata(env);
  const signingKey = enterpriseCellMigrationSigningKey(env);
  const writerRoles = writerRoleNames(env);
  const outputFile = required(env.ENTERPRISE_CELL_MIGRATION_EVIDENCE_FILE,
    "ENTERPRISE_CELL_MIGRATION_EVIDENCE_FILE");
  const source = database("SOURCE", metadata, env);
  const target = database("TARGET", metadata, env);
  const sourceClient = client(source.url, env);
  const targetClient = client(target.url, env);
  await sourceClient.connect();
  try {
    await targetClient.connect();
    try {
      if (command === "export") {
        await runExport(sourceClient, targetClient, metadata, writerRoles,
          outputFile, signingKey);
      } else if (command === "cutover") {
        await runCutover(sourceClient, targetClient, metadata, writerRoles,
          outputFile, signingKey, env);
      } else if (command === "rollback") {
        await runRollback(targetClient, sourceClient, metadata, writerRoles,
          outputFile, signingKey, env);
      } else {
        printEvidence(await attestEnterpriseCellMigration(
          sourceClient, targetClient, metadata, writerRoles,
          outputFile, signingKey, env,
        ));
      }
    } finally {
      await targetClient.end();
    }
  } finally {
    await sourceClient.end();
  }
}
async function runExport(
  source: EnterprisePostgresClient,
  target: EnterprisePostgresClient,
  metadata: EnterpriseCellMigrationMetadata,
  writerRoles: string[],
  outputFile: string,
  signingKey: string,
) {
  assertFence(await enterpriseCellWriterFence(source, target, writerRoles));
  const manifest = await exportEnterpriseTenantCell(source, {
    tenantId: metadata.tenantId,
    logicalId: metadata.sourceLogicalId,
    expectedCellId: metadata.sourceCellId,
  });
  const evidence = writeEnterpriseCellMigrationEvidence(outputFile, {
    formatVersion: 1,
    kind: "enterprise_cell_migration",
    phase: "export",
    status: "matched",
    metadata,
    source: manifest,
    capturedAt: new Date().toISOString(),
  }, signingKey);
  printEvidence(evidence);
}
async function runCutover(
  source: EnterprisePostgresClient,
  target: EnterprisePostgresClient,
  metadata: EnterpriseCellMigrationMetadata,
  writerRoles: string[],
  outputFile: string,
  signingKey: string,
  env: NodeJS.ProcessEnv,
) {
  const previous = previousEvidence(
    env, signingKey, "export", metadata, outputFile,
  );
  const preflight = await exportEnterpriseTenantCell(source, {
    tenantId: metadata.tenantId,
    logicalId: metadata.sourceLogicalId,
    expectedCellId: metadata.sourceCellId,
  });
  assertSameManifest(previous.evidence.source, preflight);
  const receipt = objectReceipt(env);
  assertEnterpriseCellObjectReceipt(receipt, metadata, preflight);
  const result = await transferEnterpriseTenantCell(source, target, {
    tenantId: metadata.tenantId,
    sourceLogicalId: metadata.sourceLogicalId,
    targetLogicalId: metadata.targetLogicalId,
    sourceCellId: metadata.sourceCellId,
    targetCellId: metadata.targetCellId,
    writerRoles,
  });
  assertSameManifest(preflight, result.source);
  const evidence = writeEnterpriseCellMigrationEvidence(outputFile, {
    formatVersion: 1,
    kind: "enterprise_cell_migration",
    phase: "cutover",
    status: result.comparison.status,
    metadata,
    source: result.source,
    target: result.target,
    comparison: result.comparison,
    writerFence: result.writerFence,
    previousEvidence: { fileSha256: previous.fileSha256, phase: "export" },
    ...(receipt ? { objectReceipt: unsignedReceipt(receipt) } : {}),
    capturedAt: new Date().toISOString(),
  }, signingKey);
  printEvidence(evidence);
}
async function runRollback(
  current: EnterprisePostgresClient,
  rollbackTarget: EnterprisePostgresClient,
  metadata: EnterpriseCellMigrationMetadata,
  writerRoles: string[],
  outputFile: string,
  signingKey: string,
  env: NodeJS.ProcessEnv,
) {
  const previous = previousEvidence(
    env, signingKey, "cutover", metadata, outputFile,
  );
  if (!previous.evidence.target) {
    throw new Error("Enterprise cell cutover evidence has no target manifest");
  }
  const preflight = await exportEnterpriseTenantCell(current, {
    tenantId: metadata.tenantId,
    logicalId: metadata.targetLogicalId,
    expectedCellId: metadata.targetCellId,
  });
  assertDatabase(previous.evidence.target, preflight, metadata.targetLogicalId);
  const rollbackMetadata = { ...metadata,
    sourceCellId: metadata.targetCellId, targetCellId: metadata.sourceCellId };
  const receipt = objectReceipt(env);
  assertEnterpriseCellObjectReceipt(receipt, rollbackMetadata, preflight);
  const result = await transferEnterpriseTenantCell(current, rollbackTarget, {
    tenantId: metadata.tenantId,
    sourceLogicalId: metadata.targetLogicalId,
    targetLogicalId: metadata.sourceLogicalId,
    sourceCellId: metadata.targetCellId,
    targetCellId: metadata.sourceCellId,
    writerRoles,
    replaceTarget: true,
    expectedTargetDatabase: previous.evidence.source.database,
  });
  assertSameManifest(preflight, result.source);
  const evidence = writeEnterpriseCellMigrationEvidence(outputFile, {
    formatVersion: 1,
    kind: "enterprise_cell_migration",
    phase: "rollback",
    status: result.comparison.status,
    metadata,
    source: result.source,
    target: result.target,
    comparison: result.comparison,
    writerFence: result.writerFence,
    previousEvidence: { fileSha256: previous.fileSha256, phase: "cutover" },
    ...(receipt ? { objectReceipt: unsignedReceipt(receipt) } : {}),
    capturedAt: new Date().toISOString(),
  }, signingKey);
  printEvidence(evidence);
}
function previousEvidence(
  env: NodeJS.ProcessEnv,
  key: string,
  phase: "export" | "cutover",
  metadata: EnterpriseCellMigrationMetadata,
  outputFile: string,
) {
  const file = required(env.ENTERPRISE_CELL_MIGRATION_PREVIOUS_EVIDENCE_FILE,
    "ENTERPRISE_CELL_MIGRATION_PREVIOUS_EVIDENCE_FILE");
  if (resolve(file) === resolve(outputFile)) {
    throw new Error("Enterprise cell output must not overwrite previous evidence");
  }
  const result = readEnterpriseCellMigrationEvidence(file, key);
  if (result.evidence.phase !== phase || result.evidence.status !== "matched" ||
    JSON.stringify(result.evidence.metadata) !== JSON.stringify(metadata)) {
    throw new Error("Enterprise cell previous evidence does not match this operation");
  }
  return result;
}

function objectReceipt(env: NodeJS.ProcessEnv) {
  const file = env.ENTERPRISE_CELL_MIGRATION_OBJECT_RECEIPT_FILE?.trim();
  return file ? readEnterpriseCellObjectReceipt(
    file, enterpriseCellObjectReceiptSigningKey(env),
  ) : undefined;
}
function unsignedReceipt(receipt: EnterpriseCellObjectReceipt) {
  const { signature: _signature, ...unsigned } = receipt;
  return unsigned;
}
function assertSameManifest(
  expected: { tenantId: string; logicalId: string; sha256: string; route: {
    cellId: string; version: number;
  }; database: { oid: string; systemIdentifier: string } },
  actual: typeof expected,
) {
  if (expected.tenantId !== actual.tenantId || expected.logicalId !== actual.logicalId ||
    expected.sha256 !== actual.sha256 || expected.route.cellId !== actual.route.cellId ||
    expected.route.version !== actual.route.version ||
    expected.database.oid !== actual.database.oid ||
    expected.database.systemIdentifier !== actual.database.systemIdentifier) {
    throw new Error("Enterprise cell export evidence is stale or points to another database");
  }
}
function assertDatabase(
  expected: { logicalId: string; database: { oid: string; systemIdentifier: string } },
  actual: typeof expected,
  logicalId: string,
) {
  if (expected.logicalId !== logicalId || actual.logicalId !== logicalId ||
    expected.database.oid !== actual.database.oid ||
    expected.database.systemIdentifier !== actual.database.systemIdentifier) {
    throw new Error("Enterprise cell evidence database identity is invalid");
  }
}
function assertFence(fence: Awaited<ReturnType<typeof enterpriseCellWriterFence>>) {
  if (!fence.sourceDefaultReadOnly || !fence.sourceWriteProbeRejected ||
    fence.sourceActiveWriterSessions || fence.targetDefaultReadOnly ||
    !fence.targetWriteProbeSucceeded || fence.targetActiveWriterSessions) {
    throw new Error("Enterprise cell writer fence is not established");
  }
}
function writerRoleNames(env: NodeJS.ProcessEnv) {
  const roles = required(env.ENTERPRISE_CELL_MIGRATION_WRITER_ROLES,
    "ENTERPRISE_CELL_MIGRATION_WRITER_ROLES").split(",").map((role) => role.trim());
  if (!roles.length || new Set(roles).size !== roles.length ||
    roles.some((role) => !/^[a-z_][a-z0-9_]{0,62}$/.test(role))) {
    throw new Error("ENTERPRISE_CELL_MIGRATION_WRITER_ROLES is invalid");
  }
  return roles;
}
function database(
  prefix: "SOURCE" | "TARGET",
  metadata: EnterpriseCellMigrationMetadata,
  env: NodeJS.ProcessEnv,
) {
  return { url: required(env[`ENTERPRISE_CELL_MIGRATION_${prefix}_DATABASE_URL`],
    `ENTERPRISE_CELL_MIGRATION_${prefix}_DATABASE_URL`),
  logicalId: prefix === "SOURCE" ? metadata.sourceLogicalId : metadata.targetLogicalId };
}
function client(url: string, env: NodeJS.ProcessEnv) {
  return createEnterprisePostgresClient({ connectionString: url,
    ssl: enterprisePostgresSslConfig(env) });
}
function summary(manifest: { tenantId: string; logicalId: string; totalCount: number;
  sha256: string; route: { cellId: string; version: number } }) {
  return { tenantId: manifest.tenantId, logicalId: manifest.logicalId,
    totalCount: manifest.totalCount, sha256: manifest.sha256, route: manifest.route };
}
function printEvidence(evidence: { phase: string; status: string; source: Parameters<
  typeof summary>[0]; target?: Parameters<typeof summary>[0] }) {
  print({ phase: evidence.phase, status: evidence.status,
    source: summary(evidence.source),
    ...(evidence.target ? { target: summary(evidence.target) } : {}) });
}
function print(value: object) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
