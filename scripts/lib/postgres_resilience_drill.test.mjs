import { describe, expect, it } from "vitest";
import { runPostgresResilienceDrill } from "./postgres_resilience_drill.mjs";
import { assertPostgresResilienceAttestation } from
  "./postgres_resilience_attestation.mjs";
import { validPostgresResilienceDrillConfig } from
  "./postgres_resilience_drill_fixture.mjs";

describe("runPostgresResilienceDrill", () => {
  it("sequences failover, fencing, discovery, rebuild, and off-host PITR", async () => {
    const runner = new FakeRunner();
    const drill = await runPostgresResilienceDrill({
      config: validPostgresResilienceDrillConfig(),
      runner,
      runId: "pg-resilience-test-001",
      topologySha256: "a".repeat(64),
      capacityResultSha256: "b".repeat(64),
      enterpriseBinding: binding(),
      environment: { POSTGRES_RESILIENCE_STAGING_ACK: "WUJIE_POSTGRES_STAGING_ONLY" },
    });

    expect(drill.result.status).toBe("passed");
    expect(runner.labels).toEqual([
      "ha-baseline",
      "wal-createBaseBackup",
      "wal-verifyArchive",
      "ha-triggerFailover",
      "ha-verifyFencing",
      "ha-verifyEndpoint",
      "ha-rebuildOldPrimary",
      "wal-restoreOffHost",
      "wal-verifyRestore",
    ]);
    expect(drill.result.ha.automaticFailover).toMatchObject({
      status: "passed",
      oldPrimaryWriteRejected: true,
      endpointSwitched: true,
      oldPrimaryRejoined: true,
      observedRpoSeconds: 2,
      observedRtoSeconds: 45,
    });
    expect(drill.result.wal).toMatchObject({
      offHost: true,
      encryptedInTransit: true,
      encryptedAtRest: true,
      immutable: true,
      unresolvedArchiveFailures: 0,
    });
    expect(runner.shutdownCalled).toBe(true);
  });

  it("fails when the old primary accepts writes", async () => {
    const runner = new FakeRunner({ fencingPassed: false });
    const drill = await runPostgresResilienceDrill({
      config: validPostgresResilienceDrillConfig(),
      runner,
      runId: "pg-resilience-test-002",
      topologySha256: "a".repeat(64),
      capacityResultSha256: "b".repeat(64),
      enterpriseBinding: binding(),
      environment: { POSTGRES_RESILIENCE_STAGING_ACK: "WUJIE_POSTGRES_STAGING_ONLY" },
    });

    expect(drill.result.status).toBe("failed");
    expect(drill.issues).toContain("Old-primary fencing was not proven");
  });

  it("requires an exact destructive staging acknowledgement", async () => {
    await expect(runPostgresResilienceDrill({
      config: validPostgresResilienceDrillConfig(),
      runner: new FakeRunner(),
      enterpriseBinding: binding(),
      topologySha256: "a".repeat(64),
      capacityResultSha256: "b".repeat(64),
      environment: {},
    })).rejects.toThrow("POSTGRES_RESILIENCE_STAGING_ACK");
  });

  it("rejects a missing enterprise cutover binding before running commands", async () => {
    const runner = new FakeRunner();
    await expect(runPostgresResilienceDrill({
      config: validPostgresResilienceDrillConfig(), runner,
    })).rejects.toThrow("Enterprise PostgreSQL DR binding is required");
    expect(runner.labels).toEqual([]);
  });

  it("rejects unexpected Provider evidence fields", () => {
    expect(() => assertPostgresResilienceAttestation({
      ...common({ env: {
        POSTGRES_RESILIENCE_RUN_ID: "run-001",
        POSTGRES_RESILIENCE_GROUP: "ha",
        POSTGRES_RESILIENCE_STEP: "baseline",
      } }),
      ...step("ha-baseline", {}),
      endpoint: "https://secret.invalid",
    }, "ha-baseline")).toThrow("unexpected fields");
  });
});

class FakeRunner {
  labels = [];
  shutdownCalled = false;

  constructor(options = {}) {
    this.options = options;
  }

  async execute(_command, options) {
    this.labels.push(options.label);
    return { ...common(options), ...step(options.label, this.options) };
  }

  async shutdown() {
    this.shutdownCalled = true;
  }
}

function common(options) {
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    tlsMode: "verify-full",
    runId: options.env.POSTGRES_RESILIENCE_RUN_ID,
    group: options.env.POSTGRES_RESILIENCE_GROUP,
    step: options.env.POSTGRES_RESILIENCE_STEP,
  };
}

function step(label, options) {
  const checksum = "c".repeat(64);
  const values = {
    "ha-baseline": {
      sourceDatabase: "ai_phone_staging",
      primaryId: "db-a",
      writeProbeId: "probe-before-1",
    },
    "wal-createBaseBackup": {
      offHost: true,
      encryptedInTransit: true,
      encryptedAtRest: true,
      immutable: true,
      immutabilityMode: "compliance_lock",
      failureDomain: "backup-zone-c",
      retentionDays: 30,
      backupId: "backup-001",
      checksumSha256: checksum,
    },
    "wal-verifyArchive": {
      unresolvedArchiveFailures: 0,
      maxObservedArchiveLagSeconds: 5,
      lastArchivedWal: "000000010000000000000001",
      objectVersionId: "version-001",
    },
    "ha-triggerFailover": {
      healthControllerInitiated: true,
      oldPrimaryId: "db-a",
      newPrimaryId: "db-b",
      oldPrimaryTimeline: 1,
      newPrimaryTimeline: 2,
      promotionGeneration: 1,
      observedRpoSeconds: 2,
      observedRtoSeconds: 45,
    },
    "ha-verifyFencing": {
      fencingPassed: options.fencingPassed ?? true,
      oldPrimaryWriteRejected: options.fencingPassed ?? true,
      testedPrimaryId: "db-a",
      writeRejectionSqlState: "25006",
      oldRouteEpochWriteRejected: true,
      oldWorkerGenerationRejected: true,
    },
    "ha-verifyEndpoint": {
      endpointSwitched: true,
      discoveredPrimaryId: "db-b",
      writeProbeSucceeded: true,
      databaseSystemIdentifier: "system-123",
    },
    "ha-rebuildOldPrimary": {
      oldPrimaryRejoined: true,
      rejoinedNodeId: "db-a",
      role: "standby",
      timelineMatches: true,
      acceptsWrites: false,
    },
    "wal-restoreOffHost": {
      source: "off_host_object_storage",
      backupId: "backup-001",
      checksumVerified: true,
      recoveryTargetReached: true,
      restoreDatabase: "ai_phone_restore_drill_01",
      recoveryTargetTime: "2026-07-20T12:00:00.000Z",
      targetMarkerId: "marker-before-target",
      observedDataLossSeconds: 2,
    },
    "wal-verifyRestore": {
      isolatedTarget: true,
      writeIsolationVerified: true,
      restoreDatabase: "ai_phone_restore_drill_01",
      targetMarkerId: "marker-before-target",
      preTargetMarkerPresent: true,
      postTargetMarkerAbsent: true,
      targetDataSha256: checksum,
      restoredDataSha256: checksum,
      targetCriticalManifestSha256: checksum,
      restoredCriticalManifestSha256: checksum,
    },
  };
  return values[label];
}

function binding() {
  return {
    gitCommit: "abcdef1234567",
    imageDigest: `sha256:${"d".repeat(64)}`,
    topologySha256: "a".repeat(64),
    cutoverEvidenceSha256: "e".repeat(64),
    cutoverId: "cutover-001",
    cutoverRunId: "cutover-run-001",
    database: {
      logicalId: "primary",
      name: "ai_phone_staging",
      systemIdentifier: "system-123",
      oid: "42",
      manifestSha256: "f".repeat(64),
    },
    migrations: { publicCount: 31, enterpriseCount: 51, sha256: "1".repeat(64) },
  };
}
