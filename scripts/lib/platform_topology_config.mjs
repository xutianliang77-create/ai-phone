import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const requiredPools = [
  "api",
  "livekit",
  "sip",
  "translation",
  "agent",
  "egress",
  "ingress",
];

export function checkPlatformTopology(options = {}) {
  const root = options.root ?? process.cwd();
  const file = path.resolve(
    root,
    options.file ?? "infra/platform-ha/topology.json",
  );
  if (!existsSync(file)) {
    return result(file, [`Platform topology missing: ${file}`]);
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return result(file, ["Platform topology is not valid JSON"]);
  }
  const issues = [];
  if (profile.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (profile.status !== "verified" && options.release) {
    issues.push("Platform topology is not verified");
  }
  if (!Number.isInteger(profile.targetConcurrentSessions) ||
    profile.targetConcurrentSessions < 100) {
    issues.push("targetConcurrentSessions must be at least 100");
  }
  if (profile.steadyStateUtilization > 0.7 ||
    profile.steadyStateUtilization <= 0) {
    issues.push("steadyStateUtilization must be within (0, 0.7]");
  }
  if (profile.admissionRejectUtilization < 0.8 ||
    profile.admissionRejectUtilization > 0.9) {
    issues.push("admissionRejectUtilization must be within [0.8, 0.9]");
  }
  checkRegions(profile.regions, issues);
  checkPools(profile.pools, issues);
  checkState(profile.state, issues);
  checkAcceptance(profile.acceptance, issues);
  checkRouting(profile.routing, issues);
  return result(file, issues, profile);
}

function checkRouting(routing, issues) {
  if (routing?.sessionPlacement !== "home_region_sticky") {
    issues.push("Session placement must be home_region_sticky");
  }
  if (routing?.crossRegionFailover !== "new_sessions_only") {
    issues.push("Cross-region failover must be new_sessions_only");
  }
  if (!Number.isInteger(routing?.maxFailoverRtoSeconds) ||
    routing.maxFailoverRtoSeconds < 30 || routing.maxFailoverRtoSeconds > 600) {
    issues.push("Failover RTO must be 30-600 seconds");
  }
  if (routing?.turnRouting !== "region_local") {
    issues.push("TURN routing must remain region-local");
  }
}

function checkRegions(regions, issues) {
  if (!Array.isArray(regions) || regions.length < 2) {
    issues.push("At least two regions are required");
    return;
  }
  const ids = new Set();
  for (const region of regions) {
    if (!/^[a-z0-9-]{3,40}$/.test(region.id ?? "") || ids.has(region.id)) {
      issues.push("Region ids must be unique and normalized");
    }
    ids.add(region.id);
    if (region.dataRegion !== "cn") issues.push(`${region.id} violates CN data residency`);
    if (!validEndpoint(region.livekitEndpoint, "wss:")) {
      issues.push(`${region.id} has invalid LiveKit endpoint`);
    }
    if (!validEndpoint(region.apiEndpoint, "https:")) {
      issues.push(`${region.id} has invalid API endpoint`);
    }
  }
  if (!regions.some((region) => region.active && region.acceptNewSessions)) {
    issues.push("At least one active region must accept new sessions");
  }
}

function checkPools(pools, issues) {
  for (const name of requiredPools) {
    const pool = pools?.[name];
    if (!pool) {
      issues.push(`Missing independent pool: ${name}`);
      continue;
    }
    if (!Number.isInteger(pool.minReplicas) || pool.minReplicas < 1 ||
      !Number.isInteger(pool.maxReplicas) || pool.maxReplicas < pool.minReplicas) {
      issues.push(`Invalid replica range for pool: ${name}`);
    }
  }
}

function checkState(state, issues) {
  if (!["managed_ha", "patroni_etcd"].includes(state?.postgresMode)) {
    issues.push("PostgreSQL managed HA or Patroni/etcd is required");
  }
  if (state?.redisMode !== "managed_ha") issues.push("Redis HA is required");
  if (state?.objectStorageReplication !== "same_data_region") {
    issues.push("Object storage replication must remain in the same data region");
  }
  if (state?.singleWriterPerAggregate !== true) {
    issues.push("singleWriterPerAggregate must be true");
  }
}

function checkAcceptance(acceptance, issues) {
  if (JSON.stringify(acceptance?.steps) !== JSON.stringify([25, 50, 100])) {
    issues.push("Capacity acceptance steps must be 25, 50, 100");
  }
  if (acceptance?.soakMinutes < 120) issues.push("Soak duration must be at least 120m");
  if (acceptance?.providerSideEffectDuplicatesAllowed !== 0 ||
    acceptance?.lostFinalEventsAllowed !== 0) {
    issues.push("Duplicate side effects and lost final events must both be zero");
  }
}

function validEndpoint(value, protocol) {
  try {
    const url = new URL(value);
    return url.protocol === protocol && !/example|localhost|127\.0\.0\.1/i.test(url.hostname);
  } catch {
    return false;
  }
}

function result(file, issues, profile) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    file,
    issues,
    ...(profile ? { profile } : {}),
  };
}
