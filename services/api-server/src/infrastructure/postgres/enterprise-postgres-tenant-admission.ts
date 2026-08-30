import { createHash } from "node:crypto";
import type { EnterpriseAdmissionCapability } from
  "./enterprise-admission-config.js";
interface EnterpriseAdmissionSession {
  readonly context: { tenantId: string };
  queryAdmission?<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export type EnterpriseAdmissionStatus =
  | "admitted"
  | "queued"
  | "queue_full"
  | "not_ready"
  | "conflict"
  | "terminal";

export interface EnterpriseAdmissionResult {
  status: EnterpriseAdmissionStatus;
  admissionId: string;
  usedCell: number;
  cellLimit: number;
  usedTenant: number;
  tenantLimit: number;
  queuePosition: number;
  retryAfterMs: number;
}

export class EnterpriseTenantAdmissionPostgresRepository {
  constructor(private readonly session: EnterpriseAdmissionSession) {}

  async reserve(input: {
    capability: EnterpriseAdmissionCapability;
    resourceType?: "worker_dispatch" | "marketing_pstn" | "screen_share";
    grantId: string;
    idempotencyKey: string;
    requestHash: string;
    tenantLimit: number;
    leaseExpiresAt: string;
    now: string;
  }): Promise<EnterpriseAdmissionResult> {
    const result = await this.query<AdmissionRow>(`
      SELECT * FROM enterprise.reserve_tenant_admission(
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
        $8, 1, $9::timestamptz, $10::timestamptz
      )
    `, [
      input.grantId,
      input.capability,
      input.resourceType ?? "worker_dispatch",
      input.grantId,
      input.idempotencyKey,
      input.requestHash,
      input.tenantLimit,
      input.leaseExpiresAt,
      input.now,
    ]);
    return mapAdmission(result.rows[0]);
  }

  async renew(input: {
    capability: EnterpriseAdmissionCapability;
    grantId: string;
    workerId: string;
    leaseExpiresAt: string;
    now: string;
  }) {
    const result = await this.query<{ renewed: unknown }>(`
      SELECT * FROM enterprise.renew_tenant_admission(
        $1::uuid, $2, $3, $4, $5::timestamptz, $6::timestamptz
      ) AS result(renewed)
    `, [input.capability, input.grantId, input.workerId,
      input.leaseExpiresAt, input.now]);
    return result.rows[0]?.renewed === true;
  }

  async release(input: {
    capability: EnterpriseAdmissionCapability;
    grantId: string;
    now: string;
  }) {
    const result = await this.query<{ released: unknown }>(`
      SELECT * FROM enterprise.release_tenant_admission(
        $1::uuid, $2, $3, $4::timestamptz
      ) AS result(released)
    `, [input.capability, input.grantId, input.now]);
    return result.rows[0]?.released === true;
  }

  async active(input: {
    capability: EnterpriseAdmissionCapability;
    grantId: string;
    workerId?: string;
    now: string;
  }) {
    const result = await this.query<{ active: unknown }>(`
      SELECT * FROM enterprise.tenant_admission_is_active(
        $1::uuid, $2, $3, $4, $5::timestamptz
      ) AS result(active)
    `, [input.capability, input.grantId, input.workerId ?? null, input.now]);
    return result.rows[0]?.active === true;
  }

  private query<Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
  ) {
    if (!this.session.queryAdmission) {
      throw new Error("Enterprise tenant admission session is unavailable");
    }
    return this.session.queryAdmission<Row>(sql, values);
  }
}

export function deterministicEnterpriseGrantId(input: {
  tenantId: string;
  capability: EnterpriseAdmissionCapability;
  idempotencyKey: string;
}) {
  const hex = createHash("sha256").update(JSON.stringify([
    "enterprise-worker-dispatch-v1",
    input.tenantId,
    input.capability,
    input.idempotencyKey,
  ])).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${
    value.slice(16, 20)
  }-${value.slice(20)}`;
}

interface AdmissionRow extends Record<string, unknown> {
  result_status: unknown;
  admission_id: unknown;
  used_cell: unknown;
  cell_limit: unknown;
  used_tenant: unknown;
  tenant_limit: unknown;
  queue_position: unknown;
  retry_after_ms: unknown;
}

function mapAdmission(row: AdmissionRow | undefined): EnterpriseAdmissionResult {
  const status = String(row?.result_status ?? "");
  if (!["admitted", "queued", "queue_full", "not_ready", "conflict", "terminal"]
    .includes(status) || !uuid(row?.admission_id)) {
    throw new Error("Invalid enterprise admission result");
  }
  return {
    status: status as EnterpriseAdmissionStatus,
    admissionId: String(row!.admission_id),
    usedCell: count(row?.used_cell),
    cellLimit: count(row?.cell_limit),
    usedTenant: count(row?.used_tenant),
    tenantLimit: count(row?.tenant_limit),
    queuePosition: count(row?.queue_position),
    retryAfterMs: count(row?.retry_after_ms),
  };
}

function count(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Invalid enterprise admission count");
  }
  return result;
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
