const stepIdentities = Object.freeze({
  baseline: ["ha", "baseline"],
  baseBackup: ["wal", "createBaseBackup"],
  archive: ["wal", "verifyArchive"],
  failover: ["ha", "triggerFailover"],
  fencing: ["ha", "verifyFencing"],
  endpoint: ["ha", "verifyEndpoint"],
  rebuild: ["ha", "rebuildOldPrimary"],
  restore: ["wal", "restoreOffHost"],
  restoreVerification: ["wal", "verifyRestore"],
});

const commonFields = [
  "schemaVersion", "status", "environment", "tlsMode", "runId", "group", "step",
];
const stepFields = Object.freeze({
  "ha-baseline": ["primaryId", "sourceDatabase", "writeProbeId"],
  "wal-createBaseBackup": ["offHost", "encryptedInTransit", "encryptedAtRest",
    "immutable", "immutabilityMode", "failureDomain", "retentionDays", "backupId",
    "checksumSha256"],
  "wal-verifyArchive": ["unresolvedArchiveFailures", "maxObservedArchiveLagSeconds",
    "lastArchivedWal", "objectVersionId"],
  "ha-triggerFailover": ["healthControllerInitiated", "oldPrimaryId", "newPrimaryId",
    "oldPrimaryTimeline", "newPrimaryTimeline", "promotionGeneration",
    "observedRpoSeconds", "observedRtoSeconds"],
  "ha-verifyFencing": ["fencingPassed", "oldPrimaryWriteRejected", "testedPrimaryId",
    "writeRejectionSqlState", "oldRouteEpochWriteRejected",
    "oldWorkerGenerationRejected"],
  "ha-verifyEndpoint": ["endpointSwitched", "discoveredPrimaryId",
    "writeProbeSucceeded", "databaseSystemIdentifier"],
  "ha-rebuildOldPrimary": ["oldPrimaryRejoined", "rejoinedNodeId", "role",
    "timelineMatches", "acceptsWrites"],
  "wal-restoreOffHost": ["source", "backupId", "checksumVerified",
    "recoveryTargetReached", "restoreDatabase", "recoveryTargetTime", "targetMarkerId",
    "observedDataLossSeconds"],
  "wal-verifyRestore": ["isolatedTarget", "writeIsolationVerified", "restoreDatabase",
    "targetMarkerId", "preTargetMarkerPresent", "postTargetMarkerAbsent",
    "targetDataSha256", "restoredDataSha256", "targetCriticalManifestSha256",
    "restoredCriticalManifestSha256"],
});

export function postgresResilienceStepIdentity(name) {
  return stepIdentities[name] ?? ["invalid", "invalid"];
}

export function assertPostgresResilienceAttestation(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} attestation must be one JSON object`);
  }
  const allowed = stepFields[label];
  if (!allowed) throw new Error(`${label} is not a recognized resilience step`);
  const unexpected = Object.keys(value).filter((key) =>
    !commonFields.includes(key) && !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} attestation contains unexpected fields`);
  }
  if (Object.values(value).some((item) => unsafeString(item))) {
    throw new Error(`${label} attestation contains unsafe string evidence`);
  }
  return value;
}

function unsafeString(value) {
  return typeof value === "string" && (value.length > 512 || /[\r\n]/.test(value) ||
    value.includes("://") || /^Bearer\s/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value));
}
