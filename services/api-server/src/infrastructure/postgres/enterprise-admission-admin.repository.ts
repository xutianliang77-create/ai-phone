import type {
  EnterpriseAdmissionPolicyInput,
  EnterpriseAdmissionPolicyManifest,
} from "./enterprise-admission-config.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import { withEnterpriseAdmissionAdminSession } from
  "./enterprise-postgres-admission-admin-session.js";

export function applyEnterpriseAdmissionPolicy(input: {
  pool: EnterprisePostgresPool;
  operatorId: string;
  policy: EnterpriseAdmissionPolicyInput;
  now: string;
}) {
  return withEnterpriseAdmissionAdminSession({
    pool: input.pool,
    cellId: input.policy.cellId,
    operatorId: input.operatorId,
    traceId: `admission-policy:${input.policy.cellId}:${input.policy.capability}`,
    async operation(session) {
      const result = await session.query<{ version: unknown }>(`
        SELECT * FROM enterprise.configure_cell_admission_policy(
          $1, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12::bigint, $2, $13::timestamptz
        ) AS result(version)
      `, [input.policy.capability, input.policy.totalConcurrencyLimit,
        input.policy.defaultTenantConcurrencyLimit,
        input.policy.defaultRateLimit, input.policy.rateWindowSeconds,
        input.policy.totalQueueLimit, input.policy.defaultTenantQueueLimit,
        input.policy.queueTtlSeconds, input.policy.status,
        input.policy.expectedVersion, input.now]);
      return version(result.rows[0]?.version);
    },
  });
}

export function applyEnterpriseAdmissionWeight(input: {
  pool: EnterprisePostgresPool;
  operatorId: string;
  weight: EnterpriseAdmissionPolicyManifest["tenantWeights"][number];
  now: string;
}) {
  return withEnterpriseAdmissionAdminSession({
    pool: input.pool,
    cellId: input.weight.cellId,
    operatorId: input.operatorId,
    traceId: `admission-weight:${input.weight.cellId}:${input.weight.capability}`,
    async operation(session) {
      const result = await session.query<{ version: unknown }>(`
        SELECT * FROM enterprise.configure_tenant_admission_weight(
          $1, $3::uuid, $4, $5, $6::bigint, $2, $7::timestamptz
        ) AS result(version)
      `, [input.weight.tenantId, input.weight.capability, input.weight.weight,
        input.weight.expectedVersion, input.now]);
      return version(result.rows[0]?.version);
    },
  });
}

export function readEnterpriseAdmissionStatus(input: {
  pool: EnterprisePostgresPool;
  operatorId: string;
  cellId: string;
  capability: string;
}) {
  return withEnterpriseAdmissionAdminSession({
    pool: input.pool,
    cellId: input.cellId,
    operatorId: input.operatorId,
    traceId: `admission-status:${input.cellId}:${input.capability}`,
    async operation(session) {
      await session.query(`
        SELECT * FROM enterprise.reconcile_cell_admission(
          $1, $3, $2, $4::timestamptz
        )
      `, [input.capability, new Date().toISOString()]);
      const result = await session.query<StatusRow>(`
        SELECT * FROM enterprise.cell_admission_status($1, $3, $2)
      `, [input.capability]);
      const row = result.rows[0];
      if (!row) return { status: "not_configured" as const };
      return {
        status: "ready" as const,
        policyStatus: text(row.policy_status),
        policyVersion: version(row.policy_version),
        totalLimit: count(row.total_limit),
        activeUnits: count(row.active_units),
        queuedUnits: count(row.queued_units),
        activeTenants: count(row.active_tenants),
        queuedTenants: count(row.queued_tenants),
      };
    },
  });
}

interface StatusRow extends Record<string, unknown> {
  policy_status: unknown; policy_version: unknown; total_limit: unknown;
  active_units: unknown; queued_units: unknown; active_tenants: unknown;
  queued_tenants: unknown;
}
function version(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid version");
  return result;
}
function count(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid count");
  return result;
}
function text(value: unknown) {
  if (value !== "active" && value !== "disabled") throw new Error("Invalid status");
  return value;
}
