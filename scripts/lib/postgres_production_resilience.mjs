import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkPlatformCapacityResult } from "./platform_capacity_result.mjs";

const haModes = new Set(["managed_ha", "patroni_etcd"]);
const walModes = new Set(["provider_managed_object_storage", "wal_g_object_storage"]);

export function checkPostgresProductionResilience(options = {}) {
  const root = options.root ?? process.cwd();
  const file = path.resolve(
    root,
    options.file ?? "outputs/postgres-resilience/latest.json",
  );
  const topology = path.resolve(
    root,
    options.topology ?? "infra/platform-ha/topology.json",
  );
  const capacity = path.resolve(
    root,
    options.capacity ?? "outputs/platform-capacity/latest.json",
  );
  const issues = [];
  const capacityCheck = checkPlatformCapacityResult({
    root,
    file: capacity,
    topology,
  });
  issues.push(...capacityCheck.issues);
  const result = readJson(file, "PostgreSQL resilience result", issues);
  if (!result) return output(file, topology, capacity, issues);
  if (result.schemaVersion !== 1) issues.push("Resilience schemaVersion must be 1");
  if (result.status !== "passed") issues.push("Resilience status must be passed");
  if (result.environment !== "staging") {
    issues.push("Resilience drill must run in isolated staging");
  }
  if (!validRunId(result.runId)) issues.push("Resilience runId is invalid");
  if (existsSync(topology) && result.topologySha256 !== sha256(topology)) {
    issues.push("Resilience result does not match the verified topology");
  }
  if (existsSync(capacity) && result.capacityResultSha256 !== sha256(capacity)) {
    issues.push("Resilience result does not match the capacity result");
  }
  checkObjectives(result.objectives, issues);
  checkHa(result.ha, result.objectives, issues);
  checkWal(result.wal, result.objectives, issues);
  checkEvidence(root, result.evidence, issues);
  return output(file, topology, capacity, issues, result);
}

function checkObjectives(objectives, issues) {
  if (!integerInRange(objectives?.maxRpoSeconds, 0, 300)) {
    issues.push("PostgreSQL max RPO must be 0-300 seconds");
  }
  if (!integerInRange(objectives?.maxRtoSeconds, 30, 120)) {
    issues.push("PostgreSQL max RTO must be 30-120 seconds");
  }
}

function checkHa(ha, objectives, issues) {
  if (!haModes.has(ha?.mode)) issues.push("Unsupported PostgreSQL HA mode");
  const nodes = Array.isArray(ha?.nodes) ? ha.nodes : [];
  const hosts = new Set(nodes.map((node) => node?.hostId).filter(validId));
  const domains = new Set(nodes.map((node) => node?.failureDomain).filter(validId));
  if (nodes.length < 2 || hosts.size !== nodes.length || domains.size < 2) {
    issues.push("HA nodes must use distinct hosts and at least two failure domains");
  }
  if (ha?.mode === "patroni_etcd" &&
    (!integerInRange(ha.dcsVoters, 3, 99) ||
      new Set(ha.dcsFailureDomains ?? []).size < 3)) {
    issues.push("Patroni requires at least three DCS voters/failure domains");
  }
  const failover = ha?.automaticFailover;
  if (failover?.status !== "passed" || failover.healthControllerInitiated !== true ||
    failover.fencingPassed !== true || failover.oldPrimaryWriteRejected !== true ||
    failover.endpointSwitched !== true || failover.oldPrimaryRejoined !== true) {
    issues.push("Automatic failover, fencing, endpoint switch, and rejoin must pass");
  }
  if (!within(failover?.observedRpoSeconds, objectives?.maxRpoSeconds) ||
    !within(failover?.observedRtoSeconds, objectives?.maxRtoSeconds)) {
    issues.push("Observed failover RPO/RTO exceeds objectives");
  }
}

function checkWal(wal, objectives, issues) {
  if (!walModes.has(wal?.mode)) issues.push("Unsupported off-host WAL mode");
  if (wal?.targetClass !== "off_host_object_storage" || wal.offHost !== true ||
    wal.encryptedInTransit !== true || wal.encryptedAtRest !== true ||
    wal.immutable !== true || !integerInRange(wal.retentionDays, 30, 3650)) {
    issues.push("WAL target must be encrypted, immutable off-host object storage");
  }
  if (wal?.unresolvedArchiveFailures !== 0 ||
    !within(wal?.maxObservedArchiveLagSeconds, objectives?.maxRpoSeconds)) {
    issues.push("WAL archive failures or lag violate the RPO objective");
  }
  const restore = wal?.restoreDrill;
  if (restore?.status !== "passed" || restore.source !== "off_host_object_storage" ||
    restore.checksumVerified !== true || restore.recoveryTargetReached !== true ||
    !within(restore.observedDataLossSeconds, objectives?.maxRpoSeconds)) {
    issues.push("Off-host checksum/PITR restore drill must pass within RPO");
  }
}

function checkEvidence(root, evidence, issues) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    issues.push("Resilience evidence files and SHA-256 values are required");
    return;
  }
  for (const item of evidence) {
    const value = item?.path;
    if (typeof value !== "string" || path.isAbsolute(value) || value.includes("..")) {
      issues.push("Resilience evidence paths must be safe repository-relative paths");
      continue;
    }
    const file = path.resolve(root, value);
    if (!existsSync(file)) issues.push(`Resilience evidence is missing: ${value}`);
    else if (!/^[a-f0-9]{64}$/.test(item?.sha256 ?? "") ||
      item.sha256 !== sha256(file)) {
      issues.push(`Resilience evidence hash mismatch: ${value}`);
    }
  }
}

function readJson(file, label, issues) {
  if (!existsSync(file)) {
    issues.push(`${label} missing: ${file}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    issues.push(`${label} is not valid JSON`);
    return null;
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function validRunId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{2,120}$/.test(value);
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function within(value, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
    typeof maximum === "number" && value <= maximum;
}

function output(file, topology, capacity, issues, result) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    file,
    topology,
    capacity,
    issues,
    ...(result ? { result } : {}),
  };
}
