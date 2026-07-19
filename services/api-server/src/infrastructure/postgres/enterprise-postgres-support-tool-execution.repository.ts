import {
  enterpriseToolConfirmationStatuses,
  enterpriseToolRiskLevels,
  type CreateEnterpriseToolExecutionInput,
} from "../../modules/enterprise/enterprise-support.js";
import { mapToolExecution, type ToolExecutionRow } from
  "./enterprise-postgres-support-records.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportToolExecutionPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async create(input: CreateEnterpriseToolExecutionInput) {
    const value = normalize(input);
    const result = await this.session.query<ToolExecutionRow>(`
      INSERT INTO enterprise.tool_executions(
        tenant_id, id, session_id, customer_id, tool_name, risk_level,
        request_hash, confirmation_status, status, idempotency_key,
        registry_definition_id, tool_revision, arguments_hash,
        authorization_scope, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $15, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.sessionId, value.customerId, value.toolName,
      value.riskLevel, value.requestHash, value.confirmationStatus,
      value.status, value.idempotencyKey, value.toolDefinitionId,
      value.toolRevision, value.argumentsHash, value.authorizationScope,
      value.createdAt]);
    if (result.rows[0]) {
      return { status: "created" as const, execution: mapToolExecution(result.rows[0]) };
    }
    const prior = await this.findByKey(value.idempotencyKey, true);
    return prior && same(prior, value)
      ? { status: "replayed" as const, execution: prior }
      : { status: "idempotency_conflict" as const };
  }

  async list(sessionId: string) {
    const result = await this.session.query<ToolExecutionRow>(`
      SELECT * FROM enterprise.tool_executions
      WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at, id
    `, [uuid(sessionId)]);
    return result.rows.map(mapToolExecution);
  }

  private async findByKey(idempotencyKey: string, lock = false) {
    const result = await this.session.query<ToolExecutionRow>(`
      SELECT * FROM enterprise.tool_executions
      WHERE tenant_id = $1 AND idempotency_key = $2 ${lock ? "FOR UPDATE" : ""}
    `, [key(idempotencyKey)]);
    return result.rows[0] ? mapToolExecution(result.rows[0]) : null;
  }
}

function normalize(input: CreateEnterpriseToolExecutionInput) {
  if (!enterpriseToolRiskLevels.includes(input.riskLevel) ||
    !enterpriseToolConfirmationStatuses.includes(input.confirmationStatus) ||
    !["requested", "awaiting_confirmation"].includes(input.status) ||
    (input.status === "awaiting_confirmation" &&
      input.confirmationStatus !== "required")) {
    throw new Error("Invalid tool execution");
  }
  return { ...input, id: uuid(input.id), sessionId: uuid(input.sessionId),
    customerId: uuid(input.customerId), toolName: toolCode(input.toolName),
    requestHash: hash(input.requestHash), idempotencyKey: key(input.idempotencyKey),
    toolDefinitionId: uuid(input.toolDefinitionId),
    toolRevision: positive(input.toolRevision),
    argumentsHash: hash(input.argumentsHash),
    authorizationScope: scope(input.authorizationScope),
    createdAt: timestamp(input.createdAt) };
}

function same(record: ReturnType<typeof mapToolExecution>,
  input: ReturnType<typeof normalize>) {
  return record.sessionId === input.sessionId && record.customerId === input.customerId &&
    record.toolName === input.toolName && record.riskLevel === input.riskLevel &&
    record.requestHash === input.requestHash &&
    record.toolDefinitionId === input.toolDefinitionId &&
    record.toolRevision === input.toolRevision &&
    record.argumentsHash === input.argumentsHash &&
    record.authorizationScope === input.authorizationScope;
}

function uuid(value: unknown) {
  if (typeof value !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Invalid support tool id");
  }
  return value;
}
function toolCode(value: unknown) {
  if (typeof value !== "string" ||
    !/^[a-z][a-z0-9_.-]{1,127}$/.test(value)) {
    throw new Error("Invalid support tool name");
  }
  return value;
}
function key(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error("Invalid support tool key");
  }
  return value;
}
function hash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Invalid support tool hash");
  }
  return value;
}
function positive(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("Invalid support tool revision");
  }
  return Number(value);
}
function scope(value: unknown) {
  if (!["support:read", "support:manage", "support:takeover"].includes(String(value))) {
    throw new Error("Invalid support tool scope");
  }
  return value as "support:read" | "support:manage" | "support:takeover";
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error("Invalid support tool timestamp");
  }
  return value;
}
