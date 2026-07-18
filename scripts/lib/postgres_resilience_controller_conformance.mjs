import {
  assertBaseBackupStorageAttestation,
  assertDcsControllerAttestation,
  assertFailureControllerAttestation,
  assertHaRecoveryControllerAttestation,
  assertRestoreIsolationAttestation,
  assertRestoreRecoveryAttestation,
  assertWalArchiveStorageAttestation,
} from "./postgres_resilience_controller_contracts.mjs";

const CONTRACTS = [
  ["dcs", assertDcsControllerAttestation, () => ({})],
  ["failureInjection", assertFailureControllerAttestation, () => ({})],
  ["haRecovery", assertHaRecoveryControllerAttestation, () => ({})],
  ["baseBackup", assertBaseBackupStorageAttestation,
    (fixture) => ({ retentionDays: fixture.expectations?.retentionDays })],
  ["walArchive", assertWalArchiveStorageAttestation,
    (fixture) => ({ targetWal: fixture.expectations?.targetWal })],
  ["restoreRecovery", assertRestoreRecoveryAttestation,
    (fixture) => ({ restoreDatabase: fixture.expectations?.restoreDatabase })],
  ["restoreIsolation", assertRestoreIsolationAttestation, () => ({})],
];

export function checkPostgresResilienceControllerConformance(fixture) {
  const issues = [];
  if (fixture?.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (fixture?.simulationOnly !== true) {
    issues.push("fixture must be explicitly marked simulationOnly");
  }
  const attestations = fixture?.attestations;
  if (!attestations || typeof attestations !== "object" || Array.isArray(attestations)) {
    issues.push("attestations must be an object");
  }
  let productionFenceVerified = true;
  for (const [name, assertion, optionsFor] of CONTRACTS) {
    const value = attestations?.[name];
    if (value?.simulationOnly !== true) {
      issues.push(`${name}: attestation must be marked simulationOnly`);
      productionFenceVerified = false;
    }
    const options = optionsFor(fixture ?? {});
    try {
      assertion(value, { ...options, allowSimulation: true });
    } catch (error) {
      issues.push(`${name}: ${error.message}`);
    }
    try {
      assertion(value, options);
      productionFenceVerified = false;
      issues.push(`${name}: production Provider accepted a simulated attestation`);
    } catch (error) {
      if (!error.message.includes("simulation is not production evidence")) {
        productionFenceVerified = false;
      }
    }
  }
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "passed" : "failed",
    simulationOnly: true,
    promotable: false,
    acceptanceScope: "controller_contract_only",
    checkedContracts: CONTRACTS.map(([name]) => name),
    productionFenceVerified,
    issues,
  };
}

export function simulatePostgresResilienceControllerFixture() {
  const simulationOnly = true;
  const targetWal = "000000010000000000000001";
  const restoreDatabase = "ai_phone_restore_simulation_01";
  return {
    schemaVersion: 1,
    simulationOnly,
    expectations: { retentionDays: 30, targetWal, restoreDatabase },
    attestations: {
      dcs: { status: "passed", simulationOnly, quorumHealthy: true,
        voterCount: 3, failureDomainCount: 3 },
      failureInjection: { status: "passed", simulationOnly, injectionObserved: true,
        automaticRecoveryEnabled: true, operationId: "simulated-failure-1" },
      haRecovery: { status: "passed", simulationOnly, recoveryRequested: true },
      baseBackup: { status: "passed", simulationOnly, offHost: true,
        encryptedInTransit: true, encryptedAtRest: true, immutable: true,
        retentionDays: 30, checksumSha256: "a".repeat(64),
        objectVersionId: "simulated-backup-version-1" },
      walArchive: { status: "passed", simulationOnly, lastArchivedWal: targetWal,
        unresolvedArchiveFailures: 0, maxObservedArchiveLagSeconds: 0,
        objectVersionId: "simulated-wal-version-1" },
      restoreRecovery: { status: "passed", simulationOnly,
        recoveryTargetReached: true, restoreDatabase, observedDataLossSeconds: 0 },
      restoreIsolation: { status: "passed", simulationOnly, isolatedTarget: true,
        writeIsolationVerified: true },
    },
  };
}
