const SHA256 = /^[a-f0-9]{64}$/;

export function assertDcsControllerAttestation(value, options = {}) {
  assertEnvelope(value, "Patroni DCS quorum", options);
  if (value.quorumHealthy !== true || !integerAtLeast(value.voterCount, 3) ||
    !integerAtLeast(value.failureDomainCount, 3)) {
    throw new Error("Patroni DCS quorum attestation failed");
  }
  return value;
}

export function assertFailureControllerAttestation(value, options = {}) {
  assertEnvelope(value, "Failure controller", options);
  if (value.injectionObserved !== true || value.automaticRecoveryEnabled !== true ||
    !boundedText(value.operationId, 256)) {
    throw new Error("Failure controller did not attest bounded automatic recovery");
  }
  return value;
}

export function assertHaRecoveryControllerAttestation(value, options = {}) {
  assertEnvelope(value, "Recovery controller", options);
  if (value.recoveryRequested !== true) {
    throw new Error("Recovery controller did not accept the old Patroni primary");
  }
  return value;
}

export function assertBaseBackupStorageAttestation(value, options = {}) {
  assertEnvelope(value, "Off-host base-backup", options);
  if (value.offHost !== true || value.encryptedInTransit !== true ||
    value.encryptedAtRest !== true || value.immutable !== true ||
    !integerAtLeast(value.retentionDays, options.retentionDays) ||
    !SHA256.test(value.checksumSha256 ?? "") || !boundedText(value.objectVersionId, 512)) {
    throw new Error("Off-host base-backup encryption or immutability attestation failed");
  }
  return value;
}

export function assertWalArchiveStorageAttestation(value, options = {}) {
  assertEnvelope(value, "Off-host WAL archive", options);
  if (value.lastArchivedWal !== options.targetWal ||
    value.unresolvedArchiveFailures !== 0 ||
    !nonNegative(value.maxObservedArchiveLagSeconds) ||
    !boundedText(value.objectVersionId, 512)) {
    throw new Error("Off-host WAL archive attestation failed");
  }
  return value;
}

export function assertRestoreRecoveryAttestation(value, options = {}) {
  assertEnvelope(value, "WAL-G recovery", options);
  if (value.recoveryTargetReached !== true ||
    value.restoreDatabase !== options.restoreDatabase ||
    !nonNegative(value.observedDataLossSeconds)) {
    throw new Error("WAL-G recovery controller did not prove the isolated PITR target");
  }
  return value;
}

export function assertRestoreIsolationAttestation(value, options = {}) {
  assertEnvelope(value, "Restore isolation", options);
  if (value.isolatedTarget !== true || value.writeIsolationVerified !== true) {
    throw new Error("Restored database checksum or isolation verification failed");
  }
  return value;
}

function assertEnvelope(value, label, options) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    value.status !== "passed") {
    throw new Error(`${label} attestation failed`);
  }
  if (value.simulationOnly === true && options.allowSimulation !== true) {
    throw new Error(`${label} simulation is not production evidence`);
  }
}

function boundedText(value, maximum) {
  return typeof value === "string" && value.length >= 2 && value.length <= maximum &&
    !/[\0\r\n]/.test(value);
}

function integerAtLeast(value, minimum) {
  return Number.isInteger(value) && Number.isInteger(minimum) && value >= minimum;
}

function nonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
