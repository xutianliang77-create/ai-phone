import type {
  EnterpriseCustomerProfileRecord,
  EnterpriseSupportCaseRecord,
  EnterpriseSupportCaseStatus,
  EnterpriseSupportChannelRecord,
  EnterpriseSupportChannelStatus,
  EnterpriseSupportChannelType,
  EnterpriseSupportQueueRecord,
  EnterpriseSupportQueueStatus,
  EnterpriseSupportSessionRecord,
  EnterpriseSupportSessionStatus,
  EnterpriseToolConfirmationStatus,
  EnterpriseToolExecutionRecord,
  EnterpriseToolExecutionStatus,
  EnterpriseToolRiskLevel,
} from "../../modules/enterprise/enterprise-support.js";

export function mapSupportChannel(row: SupportChannelRow): EnterpriseSupportChannelRecord {
  return {
    id: row.id, tenantId: row.tenant_id, channelType: row.channel_type,
    provider: row.provider, configRef: row.config_ref, status: row.status,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}
export function mapSupportQueue(row: SupportQueueRow): EnterpriseSupportQueueRecord {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name, status: row.status,
    defaultPriority: Number(row.default_priority), createdBy: row.created_by,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}
export function mapCustomerProfile(row: CustomerProfileRow): EnterpriseCustomerProfileRecord {
  return {
    id: row.id, tenantId: row.tenant_id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.phone_hash ? { phoneHash: row.phone_hash } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.locale ? { locale: row.locale } : {}),
    attributes: row.attributes, consentScope: row.consent_scope,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}
export function mapSupportSession(row: SupportSessionRow): EnterpriseSupportSessionRecord {
  return {
    id: row.id, tenantId: row.tenant_id, customerId: row.customer_id,
    channelId: row.channel_id, status: row.status, priority: Number(row.priority),
    ...(row.queue_id ? { queueId: row.queue_id } : {}),
    ...(row.assigned_user_id ? { assignedUserId: row.assigned_user_id } : {}),
    ...(row.intent ? { intent: row.intent } : {}),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    ...optionalTime("queuedAt", row.queued_at),
    ...optionalTime("startedAt", row.started_at),
    ...optionalTime("handoffRequestedAt", row.handoff_requested_at),
    ...optionalTime("assignedAt", row.assigned_at),
    ...optionalTime("endedAt", row.ended_at),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    version: Number(row.version),
  };
}
export function mapSupportCase(row: SupportCaseRow): EnterpriseSupportCaseRecord {
  return {
    id: row.id, tenantId: row.tenant_id, customerId: row.customer_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    subject: row.subject, status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.resolution ? { resolution: row.resolution } : {}),
    ...(row.external_ticket_id ? { externalTicketId: row.external_ticket_id } : {}),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    ...optionalTime("resolvedAt", row.resolved_at),
    ...optionalTime("closedAt", row.closed_at), version: Number(row.version),
  };
}
export function mapToolExecution(row: ToolExecutionRow): EnterpriseToolExecutionRecord {
  return {
    id: row.id, tenantId: row.tenant_id, sessionId: row.session_id,
    customerId: row.customer_id, toolName: row.tool_name,
    riskLevel: row.risk_level, requestHash: row.request_hash,
    confirmationStatus: row.confirmation_status, status: row.status,
    ...(row.registry_definition_id ? {
      toolDefinitionId: row.registry_definition_id,
      toolRevision: Number(row.tool_revision),
      argumentsHash: row.arguments_hash!,
      authorizationScope: row.authorization_scope!,
    } : {}),
    ...(row.external_result_ref ? { externalResultRef: row.external_result_ref } : {}),
    executionAttempt: Number(row.execution_attempt),
    ...(row.execution_lease_id ? { executionLeaseId: row.execution_lease_id } : {}),
    ...optionalTime("executionLeaseExpiresAt", row.execution_lease_expires_at),
    ...(row.provider_fingerprint
      ? { providerFingerprint: row.provider_fingerprint } : {}),
    ...(row.provider_simulated === null
      ? {} : { providerSimulated: row.provider_simulated }),
    ...(row.result_document ? { resultDocument: row.result_document } : {}),
    ...(row.result_hash ? { resultHash: row.result_hash } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.confirmation_challenge_id
      ? { confirmationChallengeId: row.confirmation_challenge_id } : {}),
    ...(row.confirmation_prompt_hash
      ? { confirmationPromptHash: row.confirmation_prompt_hash } : {}),
    ...(row.confirmation_response_hash
      ? { confirmationResponseHash: row.confirmation_response_hash } : {}),
    ...(row.confirmation_run_id
      ? { confirmationRunId: row.confirmation_run_id } : {}),
    ...(row.confirmation_turn_id
      ? { confirmationTurnId: row.confirmation_turn_id } : {}),
    ...(row.confirmation_after_sequence === null ? {}
      : { confirmationAfterSequence: Number(row.confirmation_after_sequence) }),
    ...optionalTime("confirmationRequestedAt", row.confirmation_requested_at),
    ...optionalTime("confirmationExpiresAt", row.confirmation_expires_at),
    ...optionalTime("confirmationDecidedAt", row.confirmation_decided_at),
    ...(row.write_outbox_event_id
      ? { writeOutboxEventId: row.write_outbox_event_id } : {}),
    idempotencyKey: row.idempotency_key, createdAt: iso(row.created_at),
    ...optionalTime("startedAt", row.started_at),
    ...optionalTime("completedAt", row.completed_at),
    updatedAt: iso(row.updated_at), version: Number(row.version),
  };
}

function iso(value: string | Date) { return new Date(value).toISOString(); }
function optionalTime<Key extends string>(key: Key, value: string | Date | null) {
  return value ? { [key]: iso(value) } as Record<Key, string> : {};
}

export interface SupportChannelRow extends Record<string, unknown> {
  id: string; tenant_id: string; channel_type: EnterpriseSupportChannelType;
  provider: string; config_ref: string; status: EnterpriseSupportChannelStatus;
  created_at: string | Date; updated_at: string | Date; version: string | number;
}
export interface SupportQueueRow extends Record<string, unknown> {
  id: string; tenant_id: string; name: string; status: EnterpriseSupportQueueStatus;
  default_priority: string | number; created_by: string;
  created_at: string | Date; updated_at: string | Date; version: string | number;
}
export interface CustomerProfileRow extends Record<string, unknown> {
  id: string; tenant_id: string; external_id: string | null;
  phone_hash: string | null; display_name: string | null; locale: string | null;
  attributes: Record<string, unknown>; consent_scope: string[];
  created_at: string | Date; updated_at: string | Date; version: string | number;
}
export interface SupportSessionRow extends Record<string, unknown> {
  id: string; tenant_id: string; customer_id: string; channel_id: string;
  status: EnterpriseSupportSessionStatus; queue_id: string | null;
  assigned_user_id: string | null; intent: string | null; priority: string | number;
  created_at: string | Date; queued_at: string | Date | null;
  started_at: string | Date | null; handoff_requested_at: string | Date | null;
  assigned_at: string | Date | null; ended_at: string | Date | null;
  failure_code: string | null; updated_at: string | Date; version: string | number;
  creation_request_hash: string;
}
export interface SupportCaseRow extends Record<string, unknown> {
  id: string; tenant_id: string; customer_id: string; session_id: string | null;
  subject: string; status: EnterpriseSupportCaseStatus; summary: string | null;
  resolution: string | null; external_ticket_id: string | null;
  created_at: string | Date; updated_at: string | Date;
  resolved_at: string | Date | null; closed_at: string | Date | null;
  version: string | number;
}
export interface ToolExecutionRow extends Record<string, unknown> {
  id: string; tenant_id: string; session_id: string; customer_id: string;
  tool_name: string; risk_level: EnterpriseToolRiskLevel; request_hash: string;
  confirmation_status: EnterpriseToolConfirmationStatus;
  status: EnterpriseToolExecutionStatus; external_result_ref: string | null;
  idempotency_key: string; created_at: string | Date;
  started_at: string | Date | null; completed_at: string | Date | null;
  registry_definition_id: string | null; tool_revision: string | number | null;
  arguments_hash: string | null;
  authorization_scope: EnterpriseToolExecutionRecord["authorizationScope"] | null;
  execution_attempt: string | number;
  execution_lease_id: string | null;
  execution_lease_expires_at: string | Date | null;
  provider_fingerprint: string | null;
  provider_simulated: boolean | null;
  result_document: EnterpriseToolExecutionRecord["resultDocument"] | null;
  result_hash: string | null; failure_code: string | null;
  confirmation_challenge_id: string | null;
  confirmation_prompt_hash: string | null;
  confirmation_response_hash: string | null;
  confirmation_run_id: string | null;
  confirmation_turn_id: string | null;
  confirmation_after_sequence: string | number | null;
  confirmation_requested_at: string | Date | null;
  confirmation_expires_at: string | Date | null;
  confirmation_decided_at: string | Date | null;
  write_outbox_event_id: string | null;
  updated_at: string | Date; version: string | number;
}
