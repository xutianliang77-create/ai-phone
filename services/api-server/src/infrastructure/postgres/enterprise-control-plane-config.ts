import type { EnterpriseControlPlaneConfig } from
  "./enterprise-control-plane-types.js";
export type { EnterpriseControlPlaneConfig } from
  "./enterprise-control-plane-types.js";

export function loadEnterpriseControlPlaneConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseControlPlaneConfig {
  if (env.ENTERPRISE_CONTROL_PLANE_ENABLED !== "true") {
    throw new Error("Enterprise control-plane worker is not enabled");
  }
  if (!postgresRepositorySelected(env)) {
    throw new Error("Enterprise control-plane worker requires PostgreSQL");
  }
  return resolvedConfig(env, identifier(
    "ENTERPRISE_CONTROL_PLANE_WORKER_ID",
    env.ENTERPRISE_CONTROL_PLANE_WORKER_ID,
  ));
}

export function loadEnterpriseControlPlaneObserverConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseControlPlaneConfig {
  if (env.ENTERPRISE_CONTROL_PLANE_ENABLED !== "true" ||
    !postgresRepositorySelected(env)) {
    throw new Error("Enterprise control-plane observer requires PostgreSQL HA");
  }
  return resolvedConfig(env, identifier(
    "ENTERPRISE_CONTROL_PLANE_OBSERVER_ID",
    env.ENTERPRISE_CONTROL_PLANE_OBSERVER_ID,
  ));
}

function resolvedConfig(
  env: NodeJS.ProcessEnv,
  workerId: string,
): EnterpriseControlPlaneConfig {
  return {
    workerId,
    region: region(env.ENTERPRISE_CONTROL_PLANE_REGION),
    buildCommit: commit(env.ENTERPRISE_CONTROL_PLANE_BUILD_COMMIT),
    imageDigest: image(env.ENTERPRISE_CONTROL_PLANE_IMAGE_DIGEST),
    pollIntervalMs: integer(
      "ENTERPRISE_CONTROL_PLANE_POLL_INTERVAL_MS",
      env.ENTERPRISE_CONTROL_PLANE_POLL_INTERVAL_MS,
      1_000,
      60_000,
      5_000,
    ),
    batchSize: integer(
      "ENTERPRISE_CONTROL_PLANE_BATCH_SIZE",
      env.ENTERPRISE_CONTROL_PLANE_BATCH_SIZE,
      1,
      100,
      25,
    ),
    leaseMs: integer(
      "ENTERPRISE_CONTROL_PLANE_LEASE_MS",
      env.ENTERPRISE_CONTROL_PLANE_LEASE_MS,
      3_000,
      300_000,
      30_000,
    ),
    expectedReplicas: integer(
      "ENTERPRISE_CONTROL_PLANE_EXPECTED_REPLICAS",
      env.ENTERPRISE_CONTROL_PLANE_EXPECTED_REPLICAS,
      2,
      32,
      2,
    ),
    maxProvisionBacklogSeconds: integer(
      "ENTERPRISE_CONTROL_PLANE_MAX_PROVISION_BACKLOG_SECONDS",
      env.ENTERPRISE_CONTROL_PLANE_MAX_PROVISION_BACKLOG_SECONDS,
      10,
      86_400,
      300,
    ),
  };
}

export function getEnterpriseControlPlaneConfigReadiness(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.ENTERPRISE_CONTROL_PLANE_ENABLED !== "true") {
    return { status: "disabled" as const, enabled: false, issues: [] };
  }
  const issues: string[] = [];
  try {
    if (!postgresRepositorySelected(env)) {
      issues.push("Enterprise control-plane requires PostgreSQL");
    }
  } catch (error) {
    issues.push(message(error));
  }
  if (!env.ENTERPRISE_CONTROL_PLANE_DATABASE_URL?.trim()) {
    issues.push("ENTERPRISE_CONTROL_PLANE_DATABASE_URL is required");
  }
  if (!env.ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL?.trim()) {
    issues.push("ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL is required");
  }
  if (env.ENTERPRISE_CONTROL_PLANE_DATABASE_URL?.trim() &&
    env.ENTERPRISE_CONTROL_PLANE_DATABASE_URL.trim() ===
      env.ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL?.trim()) {
    issues.push("Control-plane worker and observer database roles must differ");
  }
  let configuredRegion = "";
  let buildCommit = "";
  let imageDigest = "";
  let expectedReplicas = 0;
  let maxProvisionBacklogSeconds = 0;
  try { configuredRegion = region(env.ENTERPRISE_CONTROL_PLANE_REGION); }
  catch (error) { issues.push(message(error)); }
  try { buildCommit = commit(env.ENTERPRISE_CONTROL_PLANE_BUILD_COMMIT); }
  catch (error) { issues.push(message(error)); }
  try { imageDigest = image(env.ENTERPRISE_CONTROL_PLANE_IMAGE_DIGEST); }
  catch (error) { issues.push(message(error)); }
  if (env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT?.trim() &&
    buildCommit !== env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT.trim()) {
    issues.push("Control-plane build commit does not match release candidate");
  }
  if (env.ENTERPRISE_RELEASE_IMAGE_DIGEST?.trim() &&
    imageDigest !== env.ENTERPRISE_RELEASE_IMAGE_DIGEST.trim()) {
    issues.push("Control-plane image digest does not match release candidate");
  }
  try {
    expectedReplicas = integer("ENTERPRISE_CONTROL_PLANE_EXPECTED_REPLICAS",
      env.ENTERPRISE_CONTROL_PLANE_EXPECTED_REPLICAS, 2, 32, 2);
  } catch (error) { issues.push(message(error)); }
  try {
    maxProvisionBacklogSeconds = integer(
      "ENTERPRISE_CONTROL_PLANE_MAX_PROVISION_BACKLOG_SECONDS",
      env.ENTERPRISE_CONTROL_PLANE_MAX_PROVISION_BACKLOG_SECONDS,
      10, 86_400, 300,
    );
  } catch (error) { issues.push(message(error)); }
  return {
    status: issues.length === 0 ? "configured" as const : "not_ready" as const,
    enabled: true,
    region: configuredRegion || undefined,
    buildCommit: buildCommit || undefined,
    imageDigest: imageDigest || undefined,
    expectedReplicas: expectedReplicas || undefined,
    maxProvisionBacklogSeconds: maxProvisionBacklogSeconds || undefined,
    issues,
  };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Invalid control-plane config";
}

function postgresRepositorySelected(env: NodeJS.ProcessEnv) {
  const platform = env.API_STORAGE_DRIVER?.trim().toLowerCase() || "json";
  const enterprise = env.ENTERPRISE_REPOSITORY_DRIVER?.trim().toLowerCase();
  if (!["memory", "json", "sqlite", "postgres"].includes(platform) ||
    (enterprise && !["legacy", "postgres"].includes(enterprise))) {
    throw new Error("Invalid enterprise repository driver");
  }
  if (enterprise && enterprise !== (platform === "postgres" ? "postgres" : "legacy")) {
    throw new Error("Enterprise repository driver must match API storage driver");
  }
  return platform === "postgres";
}

function identifier(field: string, value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(cleaned)) {
    throw new Error(`Invalid ${field}`);
  }
  return cleaned;
}

function region(value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(cleaned)) {
    throw new Error("Invalid ENTERPRISE_CONTROL_PLANE_REGION");
  }
  return cleaned;
}

function commit(value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  if (!/^[a-f0-9]{40}$/.test(cleaned) || /^0+$/.test(cleaned)) {
    throw new Error("Invalid ENTERPRISE_CONTROL_PLANE_BUILD_COMMIT");
  }
  return cleaned;
}

function image(value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  if (!/^sha256:[a-f0-9]{64}$/.test(cleaned) || /^sha256:0+$/.test(cleaned)) {
    throw new Error("Invalid ENTERPRISE_CONTROL_PLANE_IMAGE_DIGEST");
  }
  return cleaned;
}

function integer(
  field: string,
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}
