import {
  getEnterpriseAdmissionConfigReadiness,
  loadEnterpriseAdmissionPolicyManifest,
} from "../../infrastructure/postgres/enterprise-admission-config.js";
import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
  type EnterprisePostgresPool,
} from "../../infrastructure/postgres/enterprise-postgres-client.js";

export interface EnterpriseAdmissionLiveStatus {
  status: "ready" | "disabled" | "not_ready";
  policyCount: number;
  activeUnits: number;
  queuedUnits: number;
  issues: string[];
}
export interface EnterpriseAdmissionAvailabilityService {
  status(): Promise<EnterpriseAdmissionLiveStatus>;
  close(): Promise<void>;
}

export function createEnvironmentEnterpriseAdmissionAvailability(options: {
  env?: NodeJS.ProcessEnv;
  createPool?: (
    config: ReturnType<typeof enterprisePostgresConnectionConfig>,
  ) => EnterprisePostgresPool;
  now?: () => number;
} = {}): EnterpriseAdmissionAvailabilityService {
  const env = options.env ?? process.env;
  const configured = getEnterpriseAdmissionConfigReadiness(env);
  if (configured.status !== "configured") {
    return fixedEnterpriseAdmissionAvailability({
      status: configured.status,
      policyCount: "policyCount" in configured ? configured.policyCount : 0,
      activeUnits: 0,
      queuedUnits: 0,
      issues: configured.issues,
    });
  }
  let manifest: ReturnType<typeof loadEnterpriseAdmissionPolicyManifest>;
  let pool: EnterprisePostgresPool;
  try {
    manifest = loadEnterpriseAdmissionPolicyManifest(
      env.ENTERPRISE_ADMISSION_POLICY_FILE?.trim(),
    );
    pool = (options.createPool ?? createEnterprisePostgresPool)(
      enterprisePostgresConnectionConfig(env, "admission_observer"),
    );
  } catch {
    return fixedEnterpriseAdmissionAvailability(
      notReadyStatus(configured.policyCount, "admission_observer_not_ready"),
    );
  }
  const now = options.now ?? Date.now;
  let closed = false;
  let cached: { expiresAt: number; value: EnterpriseAdmissionLiveStatus } |
    undefined;
  return {
    async status() {
      if (closed) return notReadyStatus(
        manifest.policies.length, "admission_status_closed",
      );
      if (cached && cached.expiresAt > now()) return cached.value;
      let value: EnterpriseAdmissionLiveStatus;
      try { value = await readStatus(pool, manifest); }
      catch { value = notReadyStatus(manifest.policies.length,
        "admission_status_unavailable"); }
      cached = { expiresAt: now() + 1_000, value };
      return value;
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

export function fixedEnterpriseAdmissionAvailability(
  value: EnterpriseAdmissionLiveStatus,
): EnterpriseAdmissionAvailabilityService {
  return { async status() { return value; }, async close() {} };
}

async function readStatus(
  pool: EnterprisePostgresPool,
  manifest: ReturnType<typeof loadEnterpriseAdmissionPolicyManifest>,
) {
  const client = await pool.connect();
  try {
    const issues: string[] = [];
    let activeUnits = 0;
    let queuedUnits = 0;
    for (const policy of manifest.policies) {
      const result = await client.query<StatusRow>(`
        SELECT * FROM enterprise.cell_admission_readiness($1, $2)
      `, [policy.cellId, policy.capability]);
      const row = result.rows[0];
      if (!row || row.policy_status !== "active" ||
        number(row.policy_version) !== policy.expectedVersion + 1 ||
        number(row.total_limit) !== policy.totalConcurrencyLimit) {
        issues.push("admission_policy_not_applied");
        continue;
      }
      const active = number(row.active_units);
      const queued = number(row.queued_units);
      if (active > policy.totalConcurrencyLimit ||
        queued > policy.totalQueueLimit) {
        issues.push("admission_state_exceeds_policy");
      }
      activeUnits += active;
      queuedUnits += queued;
    }
    return {
      status: issues.length === 0 ? "ready" as const : "not_ready" as const,
      policyCount: manifest.policies.length,
      activeUnits,
      queuedUnits,
      issues: [...new Set(issues)],
    };
  } finally {
    client.release();
  }
}

interface StatusRow extends Record<string, unknown> {
  policy_status: unknown;
  policy_version: unknown;
  total_limit: unknown;
  active_units: unknown;
  queued_units: unknown;
}
function number(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid admission status");
  return result;
}
function notReadyStatus(
  policyCount: number,
  issue: string,
): EnterpriseAdmissionLiveStatus {
  return { status: "not_ready", policyCount,
    activeUnits: 0, queuedUnits: 0, issues: [issue] };
}
