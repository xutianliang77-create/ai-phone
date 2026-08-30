import { existsSync, readFileSync, statSync } from "node:fs";

export const enterpriseAdmissionCapabilities = [
  "translation_runtime",
  "voice_agent_runtime",
  "marketing_pstn",
  "screen_share",
] as const;
export type EnterpriseAdmissionCapability =
  typeof enterpriseAdmissionCapabilities[number];

export interface EnterpriseAdmissionPolicyInput {
  cellId: string;
  capability: EnterpriseAdmissionCapability;
  totalConcurrencyLimit: number;
  defaultTenantConcurrencyLimit: number;
  defaultRateLimit: number;
  rateWindowSeconds: number;
  totalQueueLimit: number;
  defaultTenantQueueLimit: number;
  queueTtlSeconds: number;
  status: "active" | "disabled";
  expectedVersion: number;
}

export interface EnterpriseAdmissionPolicyManifest {
  schemaVersion: 1;
  candidateCommit: string;
  imageDigest: string;
  policies: EnterpriseAdmissionPolicyInput[];
  tenantWeights: Array<{
    cellId: string;
    tenantId: string;
    capability: EnterpriseAdmissionCapability;
    weight: number;
    expectedVersion: number;
  }>;
}

export function loadEnterpriseAdmissionPolicyManifest(
  file = process.env.ENTERPRISE_ADMISSION_POLICY_FILE?.trim(),
) {
  if (!file || !existsSync(file)) {
    throw new Error("ENTERPRISE_ADMISSION_POLICY_FILE is required");
  }
  const stat = statSync(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > 1024 * 1024) {
    throw new Error("Enterprise admission policy file size is invalid");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Enterprise admission policy file is invalid"); }
  const manifest = parsed as Partial<EnterpriseAdmissionPolicyManifest>;
  if (manifest.schemaVersion !== 1 || !commit(manifest.candidateCommit) ||
    !image(manifest.imageDigest) || !Array.isArray(manifest.policies) ||
    manifest.policies.length === 0 || manifest.policies.length > 128 ||
    !Array.isArray(manifest.tenantWeights) || manifest.tenantWeights.length > 10_000) {
    throw new Error("Enterprise admission policy manifest is invalid");
  }
  const policies = manifest.policies.map(policy);
  const keys = policies.map((item) => `${item.cellId}:${item.capability}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Enterprise admission policies must be unique");
  }
  const cells = [...new Set(policies.map((item) => item.cellId))];
  if (cells.some((cellId) => enterpriseAdmissionCapabilities.some(
    (item) => !keys.includes(`${cellId}:${item}`),
  ))) {
    throw new Error("Every admission cell requires all capabilities");
  }
  const tenantWeights = manifest.tenantWeights.map(weight);
  const weightKeys = tenantWeights.map((item) =>
    `${item.cellId}:${item.tenantId}:${item.capability}`
  );
  if (new Set(weightKeys).size !== weightKeys.length) {
    throw new Error("Enterprise admission tenant weights must be unique");
  }
  return {
    schemaVersion: 1 as const,
    candidateCommit: manifest.candidateCommit,
    imageDigest: manifest.imageDigest,
    policies,
    tenantWeights,
  };
}

export function getEnterpriseAdmissionConfigReadiness(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.ENTERPRISE_ADMISSION_ENABLED !== "true") {
    return { status: "disabled" as const, enabled: false,
      issues: ["Enterprise tenant admission is disabled"] };
  }
  const issues: string[] = [];
  if (env.API_STORAGE_DRIVER?.trim().toLowerCase() !== "postgres") {
    issues.push("Enterprise tenant admission requires PostgreSQL");
  }
  if (!env.ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL?.trim()) {
    issues.push("ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL is required");
  }
  if (env.ENTERPRISE_ADMISSION_DATABASE_URL?.trim() &&
    env.ENTERPRISE_ADMISSION_DATABASE_URL.trim() ===
      env.ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL?.trim()) {
    issues.push("Admission operator and observer database roles must differ");
  }
  const reconcileIntervalMs = Number(
    env.ENTERPRISE_ADMISSION_RECONCILE_INTERVAL_MS ?? 5_000,
  );
  if (!Number.isInteger(reconcileIntervalMs) || reconcileIntervalMs < 1_000 ||
    reconcileIntervalMs > 60_000) {
    issues.push("ENTERPRISE_ADMISSION_RECONCILE_INTERVAL_MS is invalid");
  }
  let manifest: ReturnType<typeof loadEnterpriseAdmissionPolicyManifest> |
    undefined;
  try { manifest = loadEnterpriseAdmissionPolicyManifest(
    env.ENTERPRISE_ADMISSION_POLICY_FILE?.trim(),
  ); } catch (error) { issues.push(message(error)); }
  if (env.NODE_ENV === "production" &&
    (!env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT?.trim() ||
      !env.ENTERPRISE_RELEASE_IMAGE_DIGEST?.trim())) {
    issues.push("Production admission requires release candidate identity");
  }
  if (manifest && env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT?.trim() &&
    manifest.candidateCommit !== env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT.trim()) {
    issues.push("Enterprise admission policy commit does not match release candidate");
  }
  if (manifest && env.ENTERPRISE_RELEASE_IMAGE_DIGEST?.trim() &&
    manifest.imageDigest !== env.ENTERPRISE_RELEASE_IMAGE_DIGEST.trim()) {
    issues.push("Enterprise admission policy image does not match release candidate");
  }
  return {
    status: issues.length === 0 ? "configured" as const : "not_ready" as const,
    enabled: true,
    policyCount: manifest?.policies.length ?? 0,
    tenantWeightCount: manifest?.tenantWeights.length ?? 0,
    reconcileIntervalMs,
    candidateCommit: manifest?.candidateCommit,
    imageDigest: manifest?.imageDigest,
    issues,
  };
}

export function getEnterpriseAdmissionOperatorReadiness(
  env: NodeJS.ProcessEnv = process.env,
) {
  const base = getEnterpriseAdmissionConfigReadiness(env);
  const issues = [...base.issues];
  if (!env.ENTERPRISE_ADMISSION_DATABASE_URL?.trim()) {
    issues.push("ENTERPRISE_ADMISSION_DATABASE_URL is required");
  }
  if (!operator(env.ENTERPRISE_ADMISSION_OPERATOR_ID)) {
    issues.push("ENTERPRISE_ADMISSION_OPERATOR_ID is invalid");
  }
  return {
    ...base,
    status: issues.length === 0 ? "configured" as const : "not_ready" as const,
    issues: [...new Set(issues)],
  };
}

function policy(value: unknown): EnterpriseAdmissionPolicyInput {
  const item = value as Partial<EnterpriseAdmissionPolicyInput>;
  if (!cell(item.cellId) || !capability(item.capability) ||
    !integer(item.totalConcurrencyLimit, 1, 10_000) ||
    !integer(item.defaultTenantConcurrencyLimit, 1,
      Math.min(1_000, Number(item.totalConcurrencyLimit ?? 0))) ||
    !integer(item.defaultRateLimit, 1, 100_000) ||
    !integer(item.rateWindowSeconds, 1, 3_600) ||
    !integer(item.totalQueueLimit, 1, 100_000) ||
    !integer(item.defaultTenantQueueLimit, 1,
      Math.min(10_000, Number(item.totalQueueLimit ?? 0))) ||
    !integer(item.queueTtlSeconds, 1, 3_600) ||
    !["active", "disabled"].includes(String(item.status)) ||
    !integer(item.expectedVersion, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error("Enterprise admission policy entry is invalid");
  }
  return item as EnterpriseAdmissionPolicyInput;
}

function weight(value: unknown) {
  const item = value as EnterpriseAdmissionPolicyManifest["tenantWeights"][number];
  if (!cell(item?.cellId) || !uuid(item?.tenantId) ||
    !capability(item?.capability) || !integer(item?.weight, 1, 100) ||
    !integer(item?.expectedVersion, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error("Enterprise admission tenant weight is invalid");
  }
  return item;
}

function capability(value: unknown): value is EnterpriseAdmissionCapability {
  return enterpriseAdmissionCapabilities.includes(value as EnterpriseAdmissionCapability);
}
function cell(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(value);
}
function operator(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$/.test(value);
}
function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function commit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
}
function image(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) &&
    !/^sha256:0+$/.test(value);
}
function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "Enterprise admission config invalid";
}
