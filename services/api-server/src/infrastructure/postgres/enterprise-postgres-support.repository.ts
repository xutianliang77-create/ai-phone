import {
  canTransitionEnterpriseSupportSession,
  enterpriseSupportChannelStatuses,
  enterpriseSupportChannelTypes,
  enterpriseSupportQueueStatuses,
  enterpriseToolConfirmationStatuses,
  enterpriseToolRiskLevels,
  isEnterpriseSupportSessionStatus,
  type CreateEnterpriseCustomerProfileInput,
  type CreateEnterpriseSupportCaseInput,
  type CreateEnterpriseSupportChannelInput,
  type CreateEnterpriseSupportQueueInput,
  type CreateEnterpriseSupportSessionInput,
  type CreateEnterpriseToolExecutionInput,
  type EnterpriseSupportSessionStatus,
} from "../../modules/enterprise/enterprise-support.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  mapCustomerProfile, mapSupportCase, mapSupportChannel, mapSupportQueue,
  mapSupportSession, mapToolExecution, type CustomerProfileRow,
  type SupportCaseRow, type SupportChannelRow, type SupportQueueRow,
  type SupportSessionRow, type ToolExecutionRow,
} from "./enterprise-postgres-support-records.js";

export class EnterpriseSupportPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createChannel(input: CreateEnterpriseSupportChannelInput) {
    const value = normalizeChannel(input);
    const result = await this.session.query<SupportChannelRow>(`
      INSERT INTO enterprise.support_channels(
        tenant_id, id, channel_type, provider, config_ref, status,
        version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.channelType, value.provider, value.configRef,
      value.status, value.createdAt]);
    return result.rows[0]
      ? { status: "created" as const, channel: mapSupportChannel(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async findChannel(channelId: string) {
    const result = await this.session.query<SupportChannelRow>(`
      SELECT * FROM enterprise.support_channels
      WHERE tenant_id = $1 AND id = $2
    `, [uuid(channelId)]);
    return result.rows[0] ? mapSupportChannel(result.rows[0]) : null;
  }
  async createQueue(input: CreateEnterpriseSupportQueueInput) {
    const value = normalizeQueue(input);
    const result = await this.session.query<SupportQueueRow>(`
      INSERT INTO enterprise.support_queues(
        tenant_id, id, name, status, default_priority, created_by,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.name, value.status, value.defaultPriority,
      value.createdBy, value.createdAt]);
    return result.rows[0]
      ? { status: "created" as const, queue: mapSupportQueue(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async findQueue(queueId: string) {
    const result = await this.session.query<SupportQueueRow>(`
      SELECT * FROM enterprise.support_queues
      WHERE tenant_id = $1 AND id = $2
    `, [uuid(queueId)]);
    return result.rows[0] ? mapSupportQueue(result.rows[0]) : null;
  }
  async createCustomer(input: CreateEnterpriseCustomerProfileInput) {
    const value = normalizeCustomer(input);
    const result = await this.session.query<CustomerProfileRow>(`
      INSERT INTO enterprise.customer_profiles(
        tenant_id, id, external_id, phone_hash, display_name, locale,
        attributes, consent_scope, version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 1, $9, $9)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.externalId ?? null, value.phoneHash ?? null,
      value.displayName ?? null, value.locale ?? null,
      JSON.stringify(value.attributes), value.consentScope, value.createdAt]);
    return result.rows[0]
      ? { status: "created" as const, customer: mapCustomerProfile(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async findCustomer(customerId: string) {
    const result = await this.session.query<CustomerProfileRow>(`
      SELECT * FROM enterprise.customer_profiles
      WHERE tenant_id = $1 AND id = $2
    `, [uuid(customerId)]);
    return result.rows[0] ? mapCustomerProfile(result.rows[0]) : null;
  }
  async findCustomerByExternalId(externalId: string) {
    const result = await this.session.query<CustomerProfileRow>(`
      SELECT * FROM enterprise.customer_profiles
      WHERE tenant_id = $1 AND external_id = $2
    `, [text(externalId, 200)]);
    return result.rows[0] ? mapCustomerProfile(result.rows[0]) : null;
  }
  async createSession(input: CreateEnterpriseSupportSessionInput) {
    const value = normalizeSession(input);
    const result = await this.session.query<SupportSessionRow>(`
      INSERT INTO enterprise.support_sessions(
        tenant_id, id, customer_id, channel_id, translation_session_id,
        status, queue_id, assigned_user_id, intent, priority, version,
        creation_key, creation_request_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, NULL, 'created', NULL, NULL, $5, $6, 1,
        $7, $8, $9, $9)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.customerId, value.channelId, value.intent ?? null,
      value.priority, value.idempotencyKey, value.requestHash, value.createdAt]);
    if (result.rows[0]) {
      return { status: "created" as const, session: mapSupportSession(result.rows[0]) };
    }
    const prior = await this.findByCreationKey(value.idempotencyKey);
    if (!prior || prior.requestHash !== value.requestHash) {
      return { status: "idempotency_conflict" as const };
    }
    return { status: "replayed" as const, session: prior.session };
  }
  async findByCreationKey(idempotencyKey: string) {
    const result = await this.session.query<SupportSessionRow>(`
      SELECT * FROM enterprise.support_sessions
      WHERE tenant_id = $1 AND creation_key = $2
    `, [key(idempotencyKey)]);
    const row = result.rows[0];
    return row
      ? { session: mapSupportSession(row), requestHash: row.creation_request_hash }
      : null;
  }
  async findSession(sessionId: string, lock = false) {
    const result = await this.session.query<SupportSessionRow>(`
      SELECT * FROM enterprise.support_sessions
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(sessionId)]);
    return result.rows[0] ? mapSupportSession(result.rows[0]) : null;
  }
  async listRecoverable() {
    const result = await this.session.query<SupportSessionRow>(`
      SELECT * FROM enterprise.support_sessions
      WHERE tenant_id = $1 AND status NOT IN ('ended', 'failed')
      ORDER BY updated_at, id LIMIT 200
    `);
    return result.rows.map(mapSupportSession);
  }
  async transition(input: {
    sessionId: string; status: EnterpriseSupportSessionStatus;
    expectedVersion: number; occurredAt: string; queueId?: string;
    assignedUserId?: string; failureCode?: string;
  }) {
    if (!isEnterpriseSupportSessionStatus(input.status) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Invalid enterprise support transition version");
    }
    const occurredAt = timestamp(input.occurredAt);
    const current = await this.findSession(input.sessionId, true);
    if (!current) return { status: "not_found" as const };
    if (current.version !== input.expectedVersion) return { status: "conflict" as const };
    if (!canTransitionEnterpriseSupportSession(current.status, input.status) ||
      occurredAt < current.updatedAt) return { status: "invalid_transition" as const };
    const queueId = input.queueId ? uuid(input.queueId) : current.queueId;
    if (["waiting", "ai_active", "handoff_requested", "human_active"]
      .includes(input.status) && !queueId) return { status: "invalid_transition" as const };
    if (input.queueId) {
      const queue = await this.findQueue(input.queueId);
      if (!queue) return { status: "resource_not_found" as const };
      if (queue.status !== "active") return { status: "resource_unavailable" as const };
    }
    if (input.status === "human_active" && !input.assignedUserId) {
      return { status: "invalid_transition" as const };
    }
    const assignedUserId = input.status === "human_active"
      ? enterprisePostgresAccountSubjectId(input.assignedUserId)
      : ["ai_active", "handoff_requested"].includes(input.status)
        ? undefined : current.assignedUserId;
    const failureCode = input.status === "failed"
      ? failureCodeValue(input.failureCode) : undefined;
    const terminal = ["ended", "failed"].includes(input.status);
    const started = ["ai_active", "handoff_requested", "human_active"].includes(input.status);
    const handoff = ["handoff_requested", "human_active"].includes(input.status);
    const result = await this.session.query<SupportSessionRow>(`
      UPDATE enterprise.support_sessions SET status = $3, queue_id = $4,
        assigned_user_id = $5, queued_at = $6, started_at = $7,
        handoff_requested_at = $8, assigned_at = $9, ended_at = $10,
        failure_code = $11, updated_at = $12, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $13 AND status = $14
      RETURNING *
    `, [uuid(input.sessionId), input.status, queueId ?? null,
      assignedUserId ?? null, current.queuedAt ?? (queueId ? occurredAt : null),
      current.startedAt ?? (started ? occurredAt : null),
      current.handoffRequestedAt ?? (handoff ? occurredAt : null),
      input.status === "human_active" ? occurredAt : assignedUserId ? current.assignedAt : null,
      terminal ? occurredAt : null, failureCode ?? null, occurredAt,
      input.expectedVersion, current.status]);
    return result.rows[0]
      ? { status: "updated" as const, session: mapSupportSession(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async createCase(input: CreateEnterpriseSupportCaseInput) {
    const value = normalizeCase(input);
    const result = await this.session.query<SupportCaseRow>(`
      INSERT INTO enterprise.support_cases(
        tenant_id, id, customer_id, session_id, subject, status, summary,
        external_ticket_id, version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, 1, $8, $8)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.customerId, value.sessionId ?? null, value.subject,
      value.summary ?? null, value.externalTicketId ?? null, value.createdAt]);
    return result.rows[0]
      ? { status: "created" as const, case: mapSupportCase(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async cases(sessionId: string) {
    const result = await this.session.query<SupportCaseRow>(`
      SELECT * FROM enterprise.support_cases
      WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at, id
    `, [uuid(sessionId)]);
    return result.rows.map(mapSupportCase);
  }
  async createToolExecution(input: CreateEnterpriseToolExecutionInput) {
    const value = normalizeTool(input);
    const result = await this.session.query<ToolExecutionRow>(`
      INSERT INTO enterprise.tool_executions(
        tenant_id, id, session_id, customer_id, tool_name, risk_level,
        request_hash, confirmation_status, status, idempotency_key,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.sessionId, value.customerId, value.toolName,
      value.riskLevel, value.requestHash, value.confirmationStatus,
      value.status, value.idempotencyKey, value.createdAt]);
    return result.rows[0]
      ? { status: "created" as const, execution: mapToolExecution(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async toolExecutions(sessionId: string) {
    const result = await this.session.query<ToolExecutionRow>(`
      SELECT * FROM enterprise.tool_executions
      WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at, id
    `, [uuid(sessionId)]);
    return result.rows.map(mapToolExecution);
  }
}

function normalizeChannel(input: CreateEnterpriseSupportChannelInput) {
  if (!enterpriseSupportChannelTypes.includes(input.channelType) ||
    !enterpriseSupportChannelStatuses.includes(input.status)) throw new Error("Invalid support channel");
  return { ...input, id: uuid(input.id), provider: providerCode(input.provider),
    configRef: text(input.configRef, 200), createdAt: timestamp(input.createdAt) };
}
function normalizeQueue(input: CreateEnterpriseSupportQueueInput) {
  if (!enterpriseSupportQueueStatuses.includes(input.status) || !integer(input.defaultPriority)) {
    throw new Error("Invalid support queue");
  }
  return { ...input, id: uuid(input.id), name: text(input.name, 120),
    createdBy: enterprisePostgresAccountSubjectId(input.createdBy),
    createdAt: timestamp(input.createdAt) };
}
function normalizeCustomer(input: CreateEnterpriseCustomerProfileInput) {
  if (input.phoneHash && !/^[a-f0-9]{64}$/.test(input.phoneHash)) throw new Error("Invalid phone hash");
  if (input.locale && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.locale)) throw new Error("Invalid locale");
  if (input.attributes && (Array.isArray(input.attributes) ||
    Object.getPrototypeOf(input.attributes) !== Object.prototype)) {
    throw new Error("Invalid customer attributes");
  }
  const consentScope = input.consentScope ?? [];
  if (consentScope.length > 32 || consentScope.some((item) => !item || typeof item !== "string")) {
    throw new Error("Invalid consent scope");
  }
  return { ...input, id: uuid(input.id), externalId: optionalText(input.externalId, 200),
    displayName: optionalText(input.displayName, 120), attributes: input.attributes ?? {},
    consentScope, createdAt: timestamp(input.createdAt) };
}
function normalizeSession(input: CreateEnterpriseSupportSessionInput) {
  if (!integer(input.priority)) throw new Error("Invalid support priority");
  return { ...input, id: uuid(input.id), customerId: uuid(input.customerId),
    channelId: uuid(input.channelId), intent: optionalText(input.intent, 200),
    createdAt: timestamp(input.createdAt), idempotencyKey: key(input.idempotencyKey),
    requestHash: hash(input.requestHash) };
}
function normalizeCase(input: CreateEnterpriseSupportCaseInput) {
  return { ...input, id: uuid(input.id), customerId: uuid(input.customerId),
    sessionId: input.sessionId ? uuid(input.sessionId) : undefined,
    subject: text(input.subject, 240), summary: optionalText(input.summary, 4000),
    externalTicketId: optionalText(input.externalTicketId, 200),
    createdAt: timestamp(input.createdAt) };
}
function normalizeTool(input: CreateEnterpriseToolExecutionInput) {
  if (!enterpriseToolRiskLevels.includes(input.riskLevel) ||
    !enterpriseToolConfirmationStatuses.includes(input.confirmationStatus) ||
    !["requested", "awaiting_confirmation"].includes(input.status) ||
    (input.status === "awaiting_confirmation" && input.confirmationStatus !== "required")) {
    throw new Error("Invalid tool execution");
  }
  return { ...input, id: uuid(input.id), sessionId: uuid(input.sessionId),
    customerId: uuid(input.customerId), toolName: toolCode(input.toolName),
    requestHash: hash(input.requestHash), idempotencyKey: key(input.idempotencyKey),
    createdAt: timestamp(input.createdAt) };
}
function uuid(value: unknown) {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new Error("Invalid support ID");
  return result;
}
function text(value: unknown, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || Buffer.byteLength(result) > max) throw new Error("Invalid support text");
  return result;
}
function optionalText(value: unknown, max: number) { return value == null ? undefined : text(value, max); }
function providerCode(value: unknown) {
  const result = text(value, 64);
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(result)) throw new Error("Invalid provider code");
  return result;
}
function toolCode(value: unknown) {
  const result = text(value, 128);
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(result)) throw new Error("Invalid tool code");
  return result;
}
function failureCodeValue(value: unknown) {
  const result = text(value, 64);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(result)) throw new Error("Invalid failure code");
  return result;
}
function integer(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100; }
function key(value: unknown) {
  const result = text(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error("Invalid support key");
  return result;
}
function hash(value: unknown) {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Invalid support hash");
  return result;
}
function timestamp(value: unknown) {
  const result = text(value, 64); const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) throw new Error("Invalid support time");
  return result;
}
