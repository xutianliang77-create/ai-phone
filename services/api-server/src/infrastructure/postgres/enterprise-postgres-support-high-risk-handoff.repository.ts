import type {
  EnterpriseSupportHighRiskCategory,
  EnterpriseSupportHighRiskHandoffRecord,
} from "../../modules/enterprise/enterprise-support-high-risk-handoff.js";
import { enterpriseSupportHighRiskHandoffPolicyVersion } from
  "../../modules/enterprise/enterprise-support-high-risk-handoff.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportHighRiskHandoffPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async create(input: {
    id: string; supportSessionId: string; customerId: string;
    supportAgentRunId: string; toolDefinitionId: string; toolName: string;
    toolRevision: number; riskCategory: EnterpriseSupportHighRiskCategory;
    argumentsHash: string; riskEvidenceHash: string; requestHash: string;
    idempotencyKey: string; createdAt: string; allowCreate: boolean;
  }) {
    const value = normalize(input);
    const prior = await this.findByKey(value.idempotencyKey, true);
    if (prior) return same(prior, value)
      ? { status: "replayed" as const, request: prior }
      : { status: "idempotency_conflict" as const };
    if (!input.allowCreate) return { status: "run_mismatch" as const };
    const inserted = await this.session.query<HandoffRow>(`
      INSERT INTO enterprise.support_high_risk_handoff_requests(
        tenant_id, id, support_session_id, customer_id, support_agent_run_id,
        tool_definition_id, tool_name, tool_revision, risk_level,
        authorization_scope, confirmation_mode, risk_category, policy_version,
        arguments_hash, risk_evidence_hash, request_hash, idempotency_key, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'high_risk',
        'support:takeover', 'human_handoff', $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.supportSessionId, value.customerId,
      value.supportAgentRunId, value.toolDefinitionId, value.toolName,
      value.toolRevision, value.riskCategory, value.policyVersion,
      value.argumentsHash, value.riskEvidenceHash, value.requestHash,
      value.idempotencyKey, value.createdAt]);
    if (inserted.rows[0]) {
      return { status: "created" as const, request: mapHandoff(inserted.rows[0]) };
    }
    const raced = await this.findByKey(value.idempotencyKey, true);
    return raced && same(raced, value)
      ? { status: "replayed" as const, request: raced }
      : { status: "idempotency_conflict" as const };
  }

  private async findByKey(idempotencyKey: string, lock = false) {
    const result = await this.session.query<HandoffRow>(`
      SELECT * FROM enterprise.support_high_risk_handoff_requests
      WHERE tenant_id = $1 AND idempotency_key = $2 ${lock ? "FOR UPDATE" : ""}
    `, [key(idempotencyKey)]);
    return result.rows[0] ? mapHandoff(result.rows[0]) : null;
  }
}

interface HandoffRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  support_session_id: string;
  customer_id: string;
  support_agent_run_id: string;
  tool_definition_id: string;
  tool_name: string;
  tool_revision: string | number;
  risk_category: EnterpriseSupportHighRiskCategory;
  arguments_hash: string;
  risk_evidence_hash: string;
  request_hash: string;
  idempotency_key: string;
  created_at: string | Date;
}

function mapHandoff(row: HandoffRow): EnterpriseSupportHighRiskHandoffRecord {
  return { id: row.id, tenantId: row.tenant_id,
    supportSessionId: row.support_session_id, customerId: row.customer_id,
    supportAgentRunId: row.support_agent_run_id,
    toolDefinitionId: row.tool_definition_id, toolName: row.tool_name,
    toolRevision: Number(row.tool_revision), riskCategory: row.risk_category,
    policyVersion: enterpriseSupportHighRiskHandoffPolicyVersion,
    argumentsHash: row.arguments_hash, riskEvidenceHash: row.risk_evidence_hash,
    requestHash: row.request_hash, idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString() };
}

function normalize(input: Parameters<
  EnterpriseSupportHighRiskHandoffPostgresRepository["create"]
>[0]) {
  return { ...input, id: uuid(input.id), supportSessionId: uuid(input.supportSessionId),
    customerId: uuid(input.customerId), supportAgentRunId: uuid(input.supportAgentRunId),
    toolDefinitionId: uuid(input.toolDefinitionId),
    toolName: code(input.toolName, 128), toolRevision: positive(input.toolRevision),
    policyVersion: enterpriseSupportHighRiskHandoffPolicyVersion,
    argumentsHash: hash(input.argumentsHash), riskEvidenceHash: hash(input.riskEvidenceHash),
    requestHash: hash(input.requestHash), idempotencyKey: key(input.idempotencyKey),
    createdAt: timestamp(input.createdAt) };
}
function same(record: EnterpriseSupportHighRiskHandoffRecord,
  value: ReturnType<typeof normalize>) {
  return record.supportSessionId === value.supportSessionId &&
    record.customerId === value.customerId &&
    record.supportAgentRunId === value.supportAgentRunId &&
    record.toolDefinitionId === value.toolDefinitionId &&
    record.toolName === value.toolName && record.toolRevision === value.toolRevision &&
    record.riskCategory === value.riskCategory &&
    record.argumentsHash === value.argumentsHash &&
    record.riskEvidenceHash === value.riskEvidenceHash &&
    record.requestHash === value.requestHash;
}
function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
  throw new Error("Invalid support handoff uuid");
} return value; }
function hash(value: unknown) { if (typeof value !== "string" ||
  !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid support handoff hash"); return value; }
function positive(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) {
  throw new Error("Invalid support handoff revision");
} return Number(value); }
function code(value: unknown, max: number) { if (typeof value !== "string" ||
  value.length > max || !/^[a-z][a-z0-9_.-]+$/.test(value)) {
  throw new Error("Invalid support handoff tool");
} return value; }
function key(value: unknown) { if (typeof value !== "string" || value.length > 160 ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
  throw new Error("Invalid support handoff idempotency key");
} return value; }
function timestamp(value: unknown) { if (typeof value !== "string" ||
  Number.isNaN(Date.parse(value))) throw new Error("Invalid support handoff timestamp");
  return new Date(value).toISOString(); }
