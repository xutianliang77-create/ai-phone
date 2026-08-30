import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkPostgresProductionResilience } from
  "./postgres_production_resilience.mjs";
import {
  resolveEnterprisePostgresDrBinding,
  signEnterprisePostgresDrResult,
} from "./enterprise_postgres_dr_evidence.mjs";

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
  test("rejects a result edited after enterprise signing", () => {
    const fixture = writeFixture();
    const result = JSON.parse(readFileSync(fixture.options.file, "utf8"));
    result.ha.automaticFailover.observedRtoSeconds = 1;
    writeJson(fixture.options.file, result);
    expect(checkPostgresProductionResilience(fixture.options).issues.join(" "))
      .toContain("signature is invalid");
  });
  test("rejects shared cutover and DR evidence keys", () => {
    const fixture = writeFixture();
    fixture.options.env.ENTERPRISE_POSTGRES_DR_EVIDENCE_HMAC_KEY =
      fixture.options.env.ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY;
    const issues = checkPostgresProductionResilience(fixture.options).issues;
    expect(issues.join(" ")).toContain("keys must be distinct");
  });
  test("rejects a signed PITR data mismatch", () => {
    const fixture = writeFixture((result) => {
      result.wal.restoreDrill.restoredDataSha256 = "c".repeat(64);
    });
    const issues = checkPostgresProductionResilience(fixture.options).issues;
    expect(issues.join(" ")).toContain("PITR restore drill must pass");
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
  const cutoverFile = path.join(outputDir, "cutover.json");
  const cutoverKey = "cutover-evidence-key-at-least-32-characters";
  const drKey = "enterprise-dr-evidence-key-at-least-32-characters";
  const migrations = writeMigrations(root);
  writeJson(topologyFile, topology());
  writeFileSync(evidenceFile, "measured drill evidence\n");
  writeJson(capacityFile, capacity(sha256(topologyFile)));
  writeJson(cutoverFile, signedCutover({
    topologySha256: sha256(topologyFile),
    migrations,
    signingKey: cutoverKey,
  }));
  const env = {
    ENTERPRISE_CUTOVER_EVIDENCE_FILE: path.relative(root, cutoverFile),
    ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY: cutoverKey,
    ENTERPRISE_RUNTIME_GIT_COMMIT: "abcdef1234567",
    ENTERPRISE_RUNTIME_IMAGE_DIGEST: `sha256:${"d".repeat(64)}`,
    ENTERPRISE_POSTGRES_DR_EVIDENCE_HMAC_KEY: drKey,
  };
  const binding = resolveEnterprisePostgresDrBinding({
    root,
    topologyFile,
    env,
  });
  const result = resilience(
    sha256(topologyFile),
    sha256(capacityFile),
    sha256(evidenceFile),
    binding,
  );
  mutate?.(result);
  writeJson(resultFile, signEnterprisePostgresDrResult(result, drKey));
  return {
    evidenceFile,
    options: {
      root, file: resultFile, topology: topologyFile, capacity: capacityFile, env,
    },
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

function resilience(topologySha256, capacityResultSha256, evidenceSha256, enterprise) {
  return {
    schemaVersion: 2,
    status: "passed",
    environment: "staging",
    runId: "resilience_run_001",
    topologySha256,
    capacityResultSha256,
    enterprise,
    completedAt: "2026-07-20T12:30:00.000Z",
    objectives: { slaApprovalId: "sla-approval-001",
      slaApprovalSha256: "9".repeat(64), maxRpoSeconds: 300, maxRtoSeconds: 120 },
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
        writeRejectionSqlState: "25006",
        oldRouteEpochWriteRejected: true,
        oldWorkerGenerationRejected: true,
        rejoinedPrimaryAcceptsWrites: false,
        oldPrimaryTimeline: 1,
        newPrimaryTimeline: 2,
        promotionGeneration: 1,
        databaseSystemIdentifier: "system-123",
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
      immutabilityMode: "compliance_lock",
      failureDomain: "backup-zone-c",
      retentionDays: 30,
      unresolvedArchiveFailures: 0,
      maxObservedArchiveLagSeconds: 30,
      restoreDrill: {
        status: "passed",
        source: "off_host_object_storage",
        checksumVerified: true,
        recoveryTargetReached: true,
        recoveryTargetTime: "2026-07-20T12:00:00.000Z",
        targetMarkerId: "marker-before-target",
        preTargetMarkerPresent: true,
        postTargetMarkerAbsent: true,
        targetDataSha256: "a".repeat(64),
        restoredDataSha256: "a".repeat(64),
        targetCriticalManifestSha256: "b".repeat(64),
        restoredCriticalManifestSha256: "b".repeat(64),
        observedDataLossSeconds: 20,
      },
    },
    evidence: [{ path: "outputs/drill.log", sha256: evidenceSha256 }],
  };
}

function writeMigrations(root) {
  const publicDirectory = path.join(root, "infra/postgres/migrations");
  const enterpriseDirectory = path.join(
    root,
    "services/api-server/src/infrastructure/postgres/migrations",
  );
  mkdirSync(publicDirectory, { recursive: true });
  mkdirSync(enterpriseDirectory, { recursive: true });
  const publicMigrations = Array.from({ length: 31 }, (_, index) =>
    `${String(index + 1).padStart(3, "0")}_public`
  );
  for (const id of publicMigrations) {
    writeFileSync(path.join(publicDirectory, `${id}.sql`), `-- ${id}\n`);
  }
  const enterpriseMigrations = Array.from({ length: 56 }, (_, index) => {
    const id = `${String(index + 1).padStart(4, "0")}_enterprise`;
    const up = `-- ${id} up\n`;
    const down = `-- ${id} down\n`;
    writeFileSync(path.join(enterpriseDirectory, `${id}.up.sql`), up);
    writeFileSync(path.join(enterpriseDirectory, `${id}.down.sql`), down);
    return { id, checksum: sha256Text(`${up}\0${down}`) };
  });
  return { publicMigrations, enterpriseMigrations };
}

function signedCutover(input) {
  const target = {
    logicalId: "primary",
    database: { name: "ai_phone_staging", systemIdentifier: "system-123", oid: "42" },
    publicMigrations: input.migrations.publicMigrations,
    enterpriseMigrations: input.migrations.enterpriseMigrations,
    critical: { "enterprise.tenants": { count: 1, sha256: "e".repeat(64) } },
    sha256: "f".repeat(64),
  };
  const value = {
    formatVersion: 1,
    kind: "enterprise_primary_cutover",
    phase: "cutover",
    status: "matched",
    environment: "staging",
    runId: "cutover-run-001",
    cutoverId: "cutover-001",
    gitCommit: "abcdef1234567",
    imageDigest: `sha256:${"d".repeat(64)}`,
    topologySha256: input.topologySha256,
    source: { sha256: target.sha256 },
    target,
    comparison: { status: "matched" },
    baseline: { fileSha256: "c".repeat(64), sourceSha256: target.sha256,
      sourceWalLsn: "0/16B6C50" },
    writerFence: {
      sourceDefaultReadOnly: true, sourceWriteProbeRejected: true,
      sourceActiveWriterSessions: 0, targetDefaultReadOnly: false,
      targetWriteProbeSucceeded: true, targetActiveWriterSessions: 0,
      writerRoles: ["api_writer", "worker_writer"],
    },
    capturedAt: "2026-07-20T11:00:00.000Z",
  };
  return {
    ...value,
    signature: createHmac("sha256", input.signingKey)
      .update(stableJson(value)).digest("hex"),
  };
}
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
