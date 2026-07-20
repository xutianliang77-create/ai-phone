import { resolve } from "node:path";
import type { EnterprisePostgresClient } from "./enterprise-postgres-client.js";
import {
  assertEnterpriseCellObjectReceipt,
  enterpriseCellObjectReceiptSigningKey,
  readEnterpriseCellMigrationEvidence,
  readEnterpriseCellObjectReceipt,
  writeEnterpriseCellMigrationEvidence,
  type EnterpriseCellMigrationMetadata,
  type EnterpriseCellObjectReceipt,
} from "./enterprise-postgres-cell-evidence.js";
import {
  assertEnterpriseCellWriterFence,
  enterpriseCellWriterFence,
} from "./enterprise-postgres-cell-fence.js";
import { reconcileEnterpriseTenantCell } from
  "./enterprise-postgres-cell-transfer.js";

export async function attestEnterpriseCellMigration(
  originalSource: EnterprisePostgresClient,
  originalTarget: EnterprisePostgresClient,
  metadata: EnterpriseCellMigrationMetadata,
  writerRoles: string[],
  outputFile: string,
  signingKey: string,
  env: NodeJS.ProcessEnv,
) {
  const previousFile = required(
    env.ENTERPRISE_CELL_MIGRATION_PREVIOUS_EVIDENCE_FILE,
    "ENTERPRISE_CELL_MIGRATION_PREVIOUS_EVIDENCE_FILE",
  );
  if (resolve(previousFile) === resolve(outputFile)) {
    throw new Error("Enterprise cell output must not overwrite previous evidence");
  }
  const previous = readEnterpriseCellMigrationEvidence(previousFile, signingKey);
  assertMetadata(previous.evidence.metadata, metadata);
  if (previous.evidence.status !== "matched" ||
    (previous.evidence.phase !== "export" && previous.evidence.phase !== "cutover")) {
    throw new Error("Enterprise cell reconcile requires matched export or cutover evidence");
  }
  const rollback = previous.evidence.phase === "cutover";
  const source = rollback ? originalTarget : originalSource;
  const target = rollback ? originalSource : originalTarget;
  const sourceLogicalId = rollback ? metadata.targetLogicalId : metadata.sourceLogicalId;
  const targetLogicalId = rollback ? metadata.sourceLogicalId : metadata.targetLogicalId;
  const sourceCellId = rollback ? metadata.targetCellId : metadata.sourceCellId;
  const targetCellId = rollback ? metadata.sourceCellId : metadata.targetCellId;
  const writerFence = await enterpriseCellWriterFence(source, target, writerRoles);
  assertEnterpriseCellWriterFence(writerFence);
  const result = await reconcileEnterpriseTenantCell(source, target, {
    tenantId: metadata.tenantId, sourceLogicalId, targetLogicalId,
  });
  const baseline = rollback ? previous.evidence.target : previous.evidence.source;
  if (!baseline) throw new Error("Enterprise cell previous target evidence is missing");
  assertDatabase(baseline, result.source, sourceLogicalId, !rollback);
  if (rollback) {
    assertDatabase(
      previous.evidence.source, result.target, targetLogicalId, false,
    );
  }
  assertRoute(result.source, result.target, sourceCellId, targetCellId);
  const receiptMetadata = rollback ? { ...metadata,
    sourceCellId: metadata.targetCellId, targetCellId: metadata.sourceCellId } : metadata;
  const receipt = objectReceipt(env);
  assertEnterpriseCellObjectReceipt(receipt, receiptMetadata, result.source);
  return writeEnterpriseCellMigrationEvidence(outputFile, {
    formatVersion: 1,
    kind: "enterprise_cell_migration",
    phase: rollback ? "rollback" : "cutover",
    status: result.comparison.status,
    metadata,
    source: result.source,
    target: result.target,
    comparison: result.comparison,
    writerFence,
    previousEvidence: {
      fileSha256: previous.fileSha256,
      phase: previous.evidence.phase,
    },
    ...(receipt ? { objectReceipt: unsignedReceipt(receipt) } : {}),
    capturedAt: new Date().toISOString(),
  }, signingKey);
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
function assertMetadata(
  actual: EnterpriseCellMigrationMetadata,
  expected: EnterpriseCellMigrationMetadata,
) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Enterprise cell previous evidence metadata does not match");
  }
}
function assertDatabase(
  expected: { logicalId: string; sha256: string;
    database: { oid: string; systemIdentifier: string } },
  actual: typeof expected,
  logicalId: string,
  requireSameContent: boolean,
) {
  if (actual.logicalId !== logicalId || expected.logicalId !== logicalId ||
    expected.database.oid !== actual.database.oid ||
    expected.database.systemIdentifier !== actual.database.systemIdentifier ||
    (requireSameContent && expected.sha256 !== actual.sha256)) {
    throw new Error("Enterprise cell reconciled database identity is invalid");
  }
}
function assertRoute(
  source: { route: { cellId: string; version: number } },
  target: { route: { cellId: string; version: number } },
  sourceCellId: string,
  targetCellId: string,
) {
  if (source.route.cellId !== sourceCellId || target.route.cellId !== targetCellId ||
    target.route.version !== source.route.version + 1) {
    throw new Error("Enterprise cell reconciled route is invalid");
  }
}
function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}
