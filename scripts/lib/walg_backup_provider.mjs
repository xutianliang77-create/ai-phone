import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertBaseBackupStorageAttestation,
  assertRestoreIsolationAttestation,
  assertRestoreRecoveryAttestation,
  assertWalArchiveStorageAttestation,
} from "./postgres_resilience_controller_contracts.mjs";

export async function runWalgBackupProviderStep(options) {
  const { config, runtime, root, runId, step } = options;
  const stateFile = providerStateFile(root, config.stateDirectory, runId);
  const context = { config, runtime, runId, stateFile };
  switch (step) {
    case "create-base-backup": return createBaseBackup(context);
    case "verify-archive": return verifyArchive(context);
    case "restore-off-host": return restoreOffHost(context);
    case "verify-restore": return verifyRestore(context);
    default: throw new Error(`Unsupported WAL-G provider step: ${step}`);
  }
}

async function createBaseBackup(context) {
  const state = readState(context.stateFile, context.runId, true);
  if (state.backupCompletedAt) return passed(backupResult(state, true));
  if (!state.backupId) await reconcileOrCreateBackup(context, state);
  const attestation = await context.runtime.storageAttestation("verify-backup", {
    runId: context.runId,
    backupId: state.backupId,
  });
  assertBaseBackupStorageAttestation(attestation, {
    retentionDays: context.config.retentionDays,
  });
  state.backupCompletedAt = new Date().toISOString();
  state.backupChecksumSha256 = attestation.checksumSha256;
  state.backupObjectVersionId = attestation.objectVersionId;
  state.retentionDays = attestation.retentionDays;
  writeState(context.stateFile, state);
  return passed(backupResult(state, false));
}

async function reconcileOrCreateBackup(context, state) {
  const listed = await context.runtime.backupList();
  if (state.backupIntentAt) {
    const prior = new Set(state.backupIdsBefore ?? []);
    const discovered = listed.filter((backup) => !prior.has(backup.id));
    if (discovered.length !== 1) {
      throw new Error("WAL-G backup intent is indeterminate; reconcile before retrying");
    }
    state.backupId = discovered[0].id;
    state.backupObservedAt = new Date().toISOString();
    writeState(context.stateFile, state);
    return;
  }
  state.backupIntentAt = new Date().toISOString();
  state.backupIdsBefore = listed.map((backup) => backup.id);
  writeState(context.stateFile, state);
  await context.runtime.backupPush();
  const after = await context.runtime.backupList();
  const prior = new Set(state.backupIdsBefore);
  const created = after.filter((backup) => !prior.has(backup.id));
  if (created.length !== 1) {
    throw new Error("WAL-G did not produce exactly one attributable base backup");
  }
  state.backupId = created[0].id;
  state.backupObservedAt = new Date().toISOString();
  writeState(context.stateFile, state);
}

async function verifyArchive(context) {
  const state = completedBackupState(context);
  const switched = await context.runtime.switchWal();
  if (!validId(switched?.lastArchivedWal)) {
    throw new Error("PostgreSQL did not return a valid switched WAL segment");
  }
  await context.runtime.walShow();
  const attestation = await context.runtime.storageAttestation("verify-archive", {
    runId: context.runId,
    backupId: state.backupId,
    targetWal: switched.lastArchivedWal,
  });
  assertWalArchiveStorageAttestation(attestation, {
    targetWal: switched.lastArchivedWal,
  });
  state.archiveVerifiedAt = new Date().toISOString();
  state.lastArchivedWal = attestation.lastArchivedWal;
  state.maxObservedArchiveLagSeconds = attestation.maxObservedArchiveLagSeconds;
  state.archiveObjectVersionId = attestation.objectVersionId;
  writeState(context.stateFile, state);
  return passed({
    unresolvedArchiveFailures: 0,
    maxObservedArchiveLagSeconds: state.maxObservedArchiveLagSeconds,
    lastArchivedWal: state.lastArchivedWal,
    objectVersionId: state.archiveObjectVersionId,
  });
}

async function restoreOffHost(context) {
  const state = completedBackupState(context);
  if (!state.archiveVerifiedAt) {
    throw new Error("Off-host WAL archive has not been verified");
  }
  if (state.restoreCompletedAt) return passed(restoreResult(context, state, true));
  if (!state.restoreFetchedAt) {
    if (state.restoreIntentAt) {
      throw new Error("WAL-G restore intent is indeterminate; reconcile before retrying");
    }
    ensureEmptyRestoreDirectory(context.config.restoreDataDirectory);
    state.restoreIntentAt = new Date().toISOString();
    writeState(context.stateFile, state);
    await context.runtime.backupFetch(state.backupId);
    state.restoreFetchedAt = new Date().toISOString();
    writeState(context.stateFile, state);
  }
  const recovery = await context.runtime.recovery("restore", {
    runId: context.runId,
    backupId: state.backupId,
    targetWal: state.lastArchivedWal,
  });
  assertRestoreRecoveryAttestation(recovery, {
    restoreDatabase: context.config.restoreDatabase,
  });
  state.restoreCompletedAt = new Date().toISOString();
  state.observedDataLossSeconds = recovery.observedDataLossSeconds;
  writeState(context.stateFile, state);
  return passed(restoreResult(context, state, false));
}

async function verifyRestore(context) {
  const state = readState(context.stateFile, context.runId);
  if (!state.restoreCompletedAt) throw new Error("WAL-G restore has not completed");
  const [source, restored, sourceHash, restoredHash, isolation] = await Promise.all([
    context.runtime.databaseIdentity(context.config.writerPgService),
    context.runtime.databaseIdentity(context.config.restorePgService),
    context.runtime.logicalSha256(context.config.writerPgService),
    context.runtime.logicalSha256(context.config.restorePgService),
    context.runtime.recovery("verify-isolation", {
      runId: context.runId,
      backupId: state.backupId,
      targetWal: state.lastArchivedWal,
    }),
  ]);
  const sourceEndpoint = `${source?.serverAddress}:${source?.serverPort}`;
  const restoreEndpoint = `${restored?.serverAddress}:${restored?.serverPort}`;
  assertRestoreIsolationAttestation(isolation);
  if (source?.database !== context.config.sourceDatabase ||
    restored?.database !== context.config.restoreDatabase || restored?.inRecovery !== false ||
    sourceEndpoint === restoreEndpoint || sourceHash !== restoredHash ||
    !sha256(sourceHash)) {
    throw new Error("Restored database checksum or isolation verification failed");
  }
  state.restoreVerifiedAt = new Date().toISOString();
  state.logicalSha256 = sourceHash;
  writeState(context.stateFile, state);
  return passed({
    isolatedTarget: true,
    writeIsolationVerified: true,
    restoreDatabase: context.config.restoreDatabase,
    sourceDataSha256: sourceHash,
    restoredDataSha256: restoredHash,
  });
}

function backupResult(state, replayed) {
  return {
    offHost: true,
    encryptedInTransit: true,
    encryptedAtRest: true,
    immutable: true,
    retentionDays: state.retentionDays,
    backupId: state.backupId,
    checksumSha256: state.backupChecksumSha256,
    objectVersionId: state.backupObjectVersionId,
    replayed,
  };
}

function restoreResult(context, state, replayed) {
  return {
    source: "off_host_object_storage",
    backupId: state.backupId,
    checksumVerified: true,
    recoveryTargetReached: true,
    restoreDatabase: context.config.restoreDatabase,
    observedDataLossSeconds: state.observedDataLossSeconds,
    replayed,
  };
}

function completedBackupState(context) {
  const state = readState(context.stateFile, context.runId);
  if (!state.backupCompletedAt) throw new Error("WAL-G base backup has not completed");
  return state;
}

function ensureEmptyRestoreDirectory(directory) {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error("WAL-G restore data directory must be empty");
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function providerStateFile(root, directory, runId) {
  const target = path.resolve(root, directory);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("WAL-G provider state directory escaped the repository");
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  return path.join(target, `${runId}.json`);
}

function readState(file, runId, optional = false) {
  if (optional && !existsSync(file)) {
    return { schemaVersion: 1, runId, retentionDays: undefined };
  }
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); } catch {
    throw new Error("WAL-G provider state is missing or invalid");
  }
  if (state.schemaVersion !== 1 || state.runId !== runId) {
    throw new Error("WAL-G provider state does not match this run");
  }
  return state;
}

function writeState(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function passed(value) {
  return { schemaVersion: 1, status: "passed", environment: "staging",
    tlsMode: "verify-full", ...value };
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:+-]{2,256}$/.test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
