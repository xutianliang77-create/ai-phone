import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkPostgresProductionResilience } from
  "./postgres_production_resilience.mjs";

describe("checkPostgresProductionResilience", () => {
  test("accepts bound cross-host HA, off-host restore, and mixed soak evidence", () => {
    const fixture = writeFixture();
    const result = checkPostgresProductionResilience(fixture.options);
    expect(result).toMatchObject({ status: "ready", issues: [] });
  });

  test("rejects same-host failover and local WAL claims", () => {
    const fixture = writeFixture((result) => {
      result.ha.nodes[1].hostId = result.ha.nodes[0].hostId;
      result.wal.offHost = false;
    });
    const result = checkPostgresProductionResilience(fixture.options);
    expect(result.status).toBe("not_ready");
    expect(result.issues.join(" ")).toContain("distinct hosts");
    expect(result.issues.join(" ")).toContain("off-host object storage");
  });

  test("rejects evidence that changed after manifest signing", () => {
    const fixture = writeFixture();
    writeFileSync(fixture.evidenceFile, "tampered\n");
    const result = checkPostgresProductionResilience(fixture.options);
    expect(result.issues.join(" ")).toContain("hash mismatch");
  });
});

function writeFixture(mutate) {
  const root = mkdtempSync(path.join(tmpdir(), "postgres-resilience-"));
  const infraDir = path.join(root, "infra/platform-ha");
  const outputDir = path.join(root, "outputs");
  mkdirSync(infraDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  const topologyFile = path.join(infraDir, "topology.json");
  const capacityFile = path.join(outputDir, "capacity.json");
  const resultFile = path.join(outputDir, "resilience.json");
  const evidenceFile = path.join(outputDir, "drill.log");
  writeJson(topologyFile, topology());
  writeFileSync(evidenceFile, "measured drill evidence\n");
  writeJson(capacityFile, capacity(sha256(topologyFile)));
  const result = resilience(
    sha256(topologyFile),
    sha256(capacityFile),
    sha256(evidenceFile),
  );
  mutate?.(result);
  writeJson(resultFile, result);
  return {
    evidenceFile,
    options: { root, file: resultFile, topology: topologyFile, capacity: capacityFile },
  };
}

function topology() {
  const pools = Object.fromEntries(
    ["api", "livekit", "sip", "translation", "agent", "egress", "ingress"]
      .map((name) => [name, { minReplicas: 2, maxReplicas: 4 }]),
  );
  return {
    schemaVersion: 1,
    status: "verified",
    targetConcurrentSessions: 100,
    steadyStateUtilization: 0.7,
    admissionRejectUtilization: 0.85,
    regions: [
      {
        id: "cn-north-1",
        dataRegion: "cn",
        active: true,
        acceptNewSessions: true,
        livekitEndpoint: "wss://livekit-north.company.cn",
        apiEndpoint: "https://api-north.company.cn",
      },
      {
        id: "cn-east-1",
        dataRegion: "cn",
        active: true,
        acceptNewSessions: false,
        livekitEndpoint: "wss://livekit-east.company.cn",
        apiEndpoint: "https://api-east.company.cn",
      },
    ],
    pools,
    state: {
      postgresMode: "managed_ha",
      redisMode: "managed_ha",
      objectStorageReplication: "same_data_region",
      singleWriterPerAggregate: true,
    },
    routing: {
      sessionPlacement: "home_region_sticky",
      crossRegionFailover: "new_sessions_only",
      maxFailoverRtoSeconds: 120,
      turnRouting: "region_local",
    },
    acceptance: {
      steps: [25, 50, 100],
      soakMinutes: 120,
      providerSideEffectDuplicatesAllowed: 0,
      lostFinalEventsAllowed: 0,
    },
  };
}

function capacity(topologySha256) {
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    runId: "capacity_run_001",
    topologySha256,
    stages: [
      { concurrentSessions: 25, durationMinutes: 30, status: "passed", sloPassed: true },
      { concurrentSessions: 50, durationMinutes: 10, status: "passed", sloPassed: true },
      { concurrentSessions: 100, durationMinutes: 30, status: "passed", sloPassed: true },
    ],
    soak: {
      targetUtilization: 0.7,
      durationMinutes: 120,
      realProviderTraffic: true,
      trafficKinds: ["api", "livekit", "sip", "asr", "mt", "tts", "agent", "egress"],
      status: "passed",
      sloPassed: true,
    },
    admission: {
      observedUtilization: 0.85,
      rejectionObserved: true,
      oomCount: 0,
      unboundedQueueObserved: false,
      status: "passed",
    },
    failureInjection: { status: "passed" },
    totals: {
      providerSideEffectDuplicates: 0,
      lostFinalEvents: 0,
      duplicateSettlements: 0,
      finalCoverageRatio: 1,
    },
    evidence: ["outputs/drill.log"],
  };
}

function resilience(topologySha256, capacityResultSha256, evidenceSha256) {
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    runId: "resilience_run_001",
    topologySha256,
    capacityResultSha256,
    objectives: { maxRpoSeconds: 300, maxRtoSeconds: 120 },
    ha: {
      mode: "managed_ha",
      nodes: [
        { hostId: "db-host-a", failureDomain: "zone-a" },
        { hostId: "db-host-b", failureDomain: "zone-b" },
      ],
      dcsVoters: 0,
      dcsFailureDomains: [],
      automaticFailover: {
        status: "passed",
        healthControllerInitiated: true,
        fencingPassed: true,
        oldPrimaryWriteRejected: true,
        endpointSwitched: true,
        oldPrimaryRejoined: true,
        observedRpoSeconds: 2,
        observedRtoSeconds: 45,
      },
    },
    wal: {
      mode: "provider_managed_object_storage",
      targetClass: "off_host_object_storage",
      offHost: true,
      encryptedInTransit: true,
      encryptedAtRest: true,
      immutable: true,
      retentionDays: 30,
      unresolvedArchiveFailures: 0,
      maxObservedArchiveLagSeconds: 30,
      restoreDrill: {
        status: "passed",
        source: "off_host_object_storage",
        checksumVerified: true,
        recoveryTargetReached: true,
        observedDataLossSeconds: 20,
      },
    },
    evidence: [{ path: "outputs/drill.log", sha256: evidenceSha256 }],
  };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
