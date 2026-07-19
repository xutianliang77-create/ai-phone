import {
  enterpriseToolConfirmationStatuses,
  enterpriseToolRiskLevels,
  type CreateEnterpriseToolExecutionInput,
} from "../../modules/enterprise/enterprise-support.js";
import type { EnterpriseSupportReadToolResult,
  EnterpriseSupportWriteToolResult } from "@translation/contracts";
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

  async find(executionId: string, lock = false) {
    const result = await this.session.query<ToolExecutionRow>(`
      SELECT * FROM enterprise.tool_executions
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(executionId)]);
    return result.rows[0] ? mapToolExecution(result.rows[0]) : null;
  }

  async findByWriteOutbox(eventId: string, lock = false) {
    const result = await this.session.query<ToolExecutionRow>(`
      SELECT * FROM enterprise.tool_executions
      WHERE tenant_id = $1 AND write_outbox_event_id = $2
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(eventId)]);
    return result.rows[0] ? mapToolExecution(result.rows[0]) : null;
  }

  async prepareWriteConfirmation(input: { executionId: string;
    expectedVersion: number; challengeId: string; promptHash: string;
    runId: string; afterSequence: number; requestedAt: string; expiresAt: string }) {
    const result = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET confirmation_challenge_id = $3,
        confirmation_prompt_hash = $4, confirmation_run_id = $5,
        confirmation_after_sequence = $6, confirmation_requested_at = $7,
        confirmation_expires_at = $8, updated_at = $7, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $9
        AND risk_level = 'reversible_write' AND status = 'awaiting_confirmation'
        AND (confirmation_challenge_id IS NULL OR confirmation_expires_at <= $7)
      RETURNING *
    `, [uuid(input.executionId), uuid(input.challengeId), hash(input.promptHash),
      uuid(input.runId), nonNegative(input.afterSequence), timestamp(input.requestedAt),
      timestamp(input.expiresAt), positive(input.expectedVersion)]);
    return result.rows[0]
      ? { status: "prepared" as const, execution: mapToolExecution(result.rows[0]) }
      : { status: "conflict" as const };
  }

  async confirmWrite(input: { executionId: string; expectedVersion: number;
    challengeId: string; turnId: string; responseHash: string; decidedAt: string;
    outboxEventId: string; providerFingerprint: string; providerSimulated: boolean }) {
    const result = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET status = 'confirmed',
        confirmation_status = 'confirmed', confirmation_turn_id = $4,
        confirmation_response_hash = $5, confirmation_decided_at = $6,
        write_outbox_event_id = $7, provider_fingerprint = $8,
        provider_simulated = $9, updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND confirmation_challenge_id = $3
        AND version = $10 AND status = 'awaiting_confirmation'
        AND confirmation_expires_at >= $6 RETURNING *
    `, [uuid(input.executionId), uuid(input.challengeId), uuid(input.turnId),
      hash(input.responseHash), timestamp(input.decidedAt), uuid(input.outboxEventId),
      fingerprint(input.providerFingerprint), input.providerSimulated,
      positive(input.expectedVersion)]);
    return result.rows[0]
      ? { status: "confirmed" as const, execution: mapToolExecution(result.rows[0]) }
      : { status: "conflict" as const };
  }

  async rejectWrite(input: { executionId: string; expectedVersion: number;
    challengeId: string; turnId: string; responseHash: string; decidedAt: string }) {
    const result = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET status = 'rejected',
        confirmation_status = 'rejected', confirmation_turn_id = $4,
        confirmation_response_hash = $5, confirmation_decided_at = $6,
        completed_at = $6, updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND confirmation_challenge_id = $3
        AND version = $7 AND status = 'awaiting_confirmation'
        AND confirmation_expires_at >= $6 RETURNING *
    `, [uuid(input.executionId), uuid(input.challengeId), uuid(input.turnId),
      hash(input.responseHash), timestamp(input.decidedAt),
      positive(input.expectedVersion)]);
    return result.rows[0]
      ? { status: "rejected" as const, execution: mapToolExecution(result.rows[0]) }
      : { status: "conflict" as const };
  }

  async finalizeWrite(input: { executionId: string; expectedVersion: number;
    eventId: string; result: { status: "retry"; reasonCode: string } |
      { status: "completed"; document: EnterpriseSupportWriteToolResult;
        resultHash: string; providerReference: string } |
      { status: "failed"; reasonCode: string; providerReference: string };
    completedAt: string }) {
    const terminal = input.result.status !== "retry";
    const status = input.result.status === "retry" ? "confirmed" : input.result.status;
    const result = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET status = $4,
        execution_attempt = execution_attempt + 1,
        result_document = $5::jsonb, result_hash = $6, failure_code = $7,
        external_result_ref = $8, completed_at = $9, updated_at = $3,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND write_outbox_event_id = $10
        AND version = $11 AND status = 'confirmed' RETURNING *
    `, [uuid(input.executionId), timestamp(input.completedAt), status,
      input.result.status === "completed" ? JSON.stringify(input.result.document) : null,
      input.result.status === "completed" ? hash(input.result.resultHash) : null,
      input.result.status === "retry" || input.result.status === "failed"
        ? failure(input.result.reasonCode) : null,
      input.result.status === "completed" || input.result.status === "failed"
        ? reference(input.result.providerReference) : null,
      terminal ? timestamp(input.completedAt) : null, uuid(input.eventId),
      positive(input.expectedVersion)]);
    return result.rows[0]
      ? { status: status as "confirmed" | "completed" | "failed",
          execution: mapToolExecution(result.rows[0]) }
      : { status: "conflict" as const };
  }

  async claimRead(input: { executionId: string; expectedVersion: number;
    leaseId: string; providerFingerprint: string; providerSimulated: boolean; now: string;
    leaseExpiresAt: string }) {
    const updated = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET status = 'running',
        started_at = COALESCE(started_at, $3), execution_attempt = execution_attempt + 1,
        execution_lease_id = $4, execution_lease_expires_at = $5,
        provider_fingerprint = $6, provider_simulated = $7,
        updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $8 AND risk_level = 'read'
        AND registry_definition_id IS NOT NULL AND (
          status = 'requested' OR
          (status = 'running' AND execution_lease_expires_at <= $3)
        ) RETURNING *
    `, [uuid(input.executionId), timestamp(input.now), uuid(input.leaseId),
      timestamp(input.leaseExpiresAt), fingerprint(input.providerFingerprint),
      input.providerSimulated, positive(input.expectedVersion)]);
    return updated.rows[0]
      ? { status: "claimed" as const, execution: mapToolExecution(updated.rows[0]) }
      : { status: "conflict" as const };
  }

  async completeRead(input: { executionId: string; expectedVersion: number;
    leaseId: string; result: EnterpriseSupportReadToolResult; resultHash: string;
    providerReference: string; completedAt: string }) {
    const updated = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET status = 'completed',
        result_document = $3::jsonb, result_hash = $4,
        external_result_ref = $5, completed_at = $6, updated_at = $6,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $7 AND status = 'running'
        AND risk_level = 'read' AND execution_lease_id = $8
        AND execution_lease_expires_at > $6
      RETURNING *
    `, [uuid(input.executionId), JSON.stringify(input.result), hash(input.resultHash),
      reference(input.providerReference), timestamp(input.completedAt),
      positive(input.expectedVersion), uuid(input.leaseId)]);
    return updated.rows[0]
      ? { status: "completed" as const, execution: mapToolExecution(updated.rows[0]) }
      : { status: "conflict" as const };
  }

  async failRead(input: { executionId: string; expectedVersion: number;
    leaseId: string; reasonCode: string; failedAt: string }) {
    const updated = await this.session.query<ToolExecutionRow>(`
      UPDATE enterprise.tool_executions SET status = 'failed',
        failure_code = $3, completed_at = $4, updated_at = $4,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 AND status = 'running'
        AND risk_level = 'read' AND execution_lease_id = $6
        AND execution_lease_expires_at > $4
      RETURNING *
    `, [uuid(input.executionId), failure(input.reasonCode), timestamp(input.failedAt),
      positive(input.expectedVersion), uuid(input.leaseId)]);
    return updated.rows[0]
      ? { status: "failed" as const, execution: mapToolExecution(updated.rows[0]) }
      : { status: "conflict" as const };
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
function nonNegative(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("Invalid support tool sequence");
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
function fingerprint(value: unknown) {
  if (typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new Error("Invalid support read tool provider fingerprint");
  }
  return value;
}
function reference(value: unknown) {
  if (typeof value !== "string" || !value.trim() ||
    Buffer.byteLength(value.trim()) > 400) {
    throw new Error("Invalid support read tool provider reference");
  }
  return value.trim();
}
function failure(value: unknown) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new Error("Invalid support read tool failure code");
  }
  return value;
}
