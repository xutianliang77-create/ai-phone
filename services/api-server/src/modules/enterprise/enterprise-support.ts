import type { EnterpriseCommunicationBindingRecord } from
  "./enterprise-communication-session.js";
import type { EnterpriseScope, EnterpriseSupportReadToolResult,
  EnterpriseSupportWriteToolResult } from
  "@translation/contracts";

export const enterpriseSupportChannelTypes = ["pstn", "web", "app"] as const;
export type EnterpriseSupportChannelType =
  typeof enterpriseSupportChannelTypes[number];
export const enterpriseSupportChannelStatuses = [
  "inactive", "active", "suspended",
] as const;
export type EnterpriseSupportChannelStatus =
  typeof enterpriseSupportChannelStatuses[number];
export const enterpriseSupportQueueStatuses = [
  "active", "paused", "disabled",
] as const;
export type EnterpriseSupportQueueStatus =
  typeof enterpriseSupportQueueStatuses[number];
export const enterpriseSupportSessionStatuses = [
  "created", "waiting", "ai_active", "handoff_requested",
  "human_active", "ended", "failed",
] as const;
export type EnterpriseSupportSessionStatus =
  typeof enterpriseSupportSessionStatuses[number];
export const enterpriseSupportCaseStatuses = [
  "open", "pending", "resolved", "closed",
] as const;
export type EnterpriseSupportCaseStatus =
  typeof enterpriseSupportCaseStatuses[number];
export const enterpriseToolRiskLevels = [
  "read", "reversible_write", "high_risk",
] as const;
export type EnterpriseToolRiskLevel = typeof enterpriseToolRiskLevels[number];
export const enterpriseToolConfirmationStatuses = [
  "not_required", "required", "confirmed", "rejected",
] as const;
export type EnterpriseToolConfirmationStatus =
  typeof enterpriseToolConfirmationStatuses[number];
export const enterpriseToolExecutionStatuses = [
  "requested", "awaiting_confirmation", "confirmed", "running",
  "completed", "rejected", "failed", "cancelled",
] as const;
export type EnterpriseToolExecutionStatus =
  typeof enterpriseToolExecutionStatuses[number];

export interface EnterpriseSupportChannelRecord {
  id: string; tenantId: string; channelType: EnterpriseSupportChannelType;
  provider: string; configRef: string; status: EnterpriseSupportChannelStatus;
  createdAt: string; updatedAt: string; version: number;
}
export interface EnterpriseSupportQueueRecord {
  id: string; tenantId: string; name: string; status: EnterpriseSupportQueueStatus;
  defaultPriority: number; handoffSlaSeconds: number; claimLeaseSeconds: number;
  createdBy: string; createdAt: string;
  updatedAt: string; version: number;
}
export interface EnterpriseCustomerProfileRecord {
  id: string; tenantId: string; externalId?: string; phoneHash?: string;
  displayName?: string; locale?: string; attributes: Record<string, unknown>;
  consentScope: string[]; createdAt: string; updatedAt: string; version: number;
}
export interface EnterpriseSupportSessionRecord {
  id: string; tenantId: string; customerId: string; channelId: string;
  status: EnterpriseSupportSessionStatus; queueId?: string;
  assignedUserId?: string; intent?: string; priority: number;
  createdAt: string; queuedAt?: string; startedAt?: string;
  handoffRequestedAt?: string; assignedAt?: string; endedAt?: string;
  activeAgentClaimId?: string;
  failureCode?: string; updatedAt: string; version: number;
}
export interface EnterpriseSupportCaseRecord {
  id: string; tenantId: string; customerId: string; sessionId?: string;
  subject: string; status: EnterpriseSupportCaseStatus; summary?: string;
  resolution?: string; externalTicketId?: string; createdAt: string;
  updatedAt: string; resolvedAt?: string; closedAt?: string; version: number;
}
export interface EnterpriseToolExecutionRecord {
  id: string; tenantId: string; sessionId: string; customerId: string;
  toolName: string; riskLevel: EnterpriseToolRiskLevel; requestHash: string;
  confirmationStatus: EnterpriseToolConfirmationStatus;
  status: EnterpriseToolExecutionStatus; externalResultRef?: string;
  toolDefinitionId?: string; toolRevision?: number;
  argumentsHash?: string; authorizationScope?: EnterpriseScope;
  executionAttempt: number; executionLeaseId?: string;
  executionLeaseExpiresAt?: string; providerFingerprint?: string;
  providerSimulated?: boolean;
  resultDocument?: EnterpriseSupportReadToolResult |
    EnterpriseSupportWriteToolResult; resultHash?: string;
  confirmationChallengeId?: string; confirmationPromptHash?: string;
  confirmationResponseHash?: string; confirmationRunId?: string;
  confirmationTurnId?: string; confirmationAfterSequence?: number;
  confirmationRequestedAt?: string; confirmationExpiresAt?: string;
  confirmationDecidedAt?: string; writeOutboxEventId?: string;
  failureCode?: string;
  idempotencyKey: string; createdAt: string; startedAt?: string;
  completedAt?: string; updatedAt: string; version: number;
}
export interface EnterpriseSupportSessionAggregate {
  session: EnterpriseSupportSessionRecord;
  channel: EnterpriseSupportChannelRecord;
  customer: EnterpriseCustomerProfileRecord;
  queue?: EnterpriseSupportQueueRecord;
  cases: EnterpriseSupportCaseRecord[];
  toolExecutions: EnterpriseToolExecutionRecord[];
  communicationBinding?: EnterpriseCommunicationBindingRecord;
}

export interface CreateEnterpriseSupportChannelInput {
  id: string; channelType: EnterpriseSupportChannelType; provider: string;
  configRef: string; status: EnterpriseSupportChannelStatus; createdAt: string;
}
export interface CreateEnterpriseSupportQueueInput {
  id: string; name: string; status: EnterpriseSupportQueueStatus;
  defaultPriority: number; handoffSlaSeconds?: number;
  claimLeaseSeconds?: number; createdBy: string; createdAt: string;
}
export interface CreateEnterpriseCustomerProfileInput {
  id: string; externalId?: string; phoneHash?: string; displayName?: string;
  locale?: string; attributes?: Record<string, unknown>;
  consentScope?: string[]; createdAt: string;
}
export interface CreateEnterpriseSupportSessionInput {
  id: string; customerId: string; channelId: string; intent?: string;
  priority: number; createdAt: string; idempotencyKey: string; requestHash: string;
}
export interface CreateEnterpriseSupportCaseInput {
  id: string; customerId: string; sessionId?: string; subject: string;
  summary?: string; externalTicketId?: string; createdAt: string;
}
export interface CreateEnterpriseToolExecutionInput {
  id: string; sessionId: string; customerId: string; toolName: string;
  riskLevel: EnterpriseToolRiskLevel; requestHash: string;
  toolDefinitionId: string; toolRevision: number;
  argumentsHash: string; authorizationScope: EnterpriseScope;
  confirmationStatus: EnterpriseToolConfirmationStatus;
  status: "requested" | "awaiting_confirmation";
  idempotencyKey: string; createdAt: string;
}

const sessionTransitions: Record<
  EnterpriseSupportSessionStatus,
  ReadonlySet<EnterpriseSupportSessionStatus>
> = {
  created: new Set(["waiting", "failed"]),
  waiting: new Set(["ai_active", "handoff_requested", "ended", "failed"]),
  ai_active: new Set(["handoff_requested", "ended", "failed"]),
  handoff_requested: new Set(["ai_active", "human_active", "ended", "failed"]),
  human_active: new Set(["handoff_requested", "ended", "failed"]),
  ended: new Set(), failed: new Set(),
};
const caseTransitions: Record<
  EnterpriseSupportCaseStatus,
  ReadonlySet<EnterpriseSupportCaseStatus>
> = {
  open: new Set(["pending", "resolved", "closed"]),
  pending: new Set(["open", "resolved", "closed"]),
  resolved: new Set(["closed"]), closed: new Set(),
};
const toolTransitions: Record<
  EnterpriseToolExecutionStatus,
  ReadonlySet<EnterpriseToolExecutionStatus>
> = {
  requested: new Set(["awaiting_confirmation", "running", "rejected", "failed", "cancelled"]),
  awaiting_confirmation: new Set(["confirmed", "rejected", "failed", "cancelled"]),
  confirmed: new Set(["running", "completed", "failed"]),
  running: new Set(["completed", "failed", "cancelled"]),
  completed: new Set(), rejected: new Set(), failed: new Set(), cancelled: new Set(),
};

export function canTransitionEnterpriseSupportSession(
  current: EnterpriseSupportSessionStatus,
  target: EnterpriseSupportSessionStatus,
) { return sessionTransitions[current].has(target); }
export function canTransitionEnterpriseSupportCase(
  current: EnterpriseSupportCaseStatus,
  target: EnterpriseSupportCaseStatus,
) { return caseTransitions[current].has(target); }
export function canTransitionEnterpriseToolExecution(
  current: EnterpriseToolExecutionStatus,
  target: EnterpriseToolExecutionStatus,
) { return toolTransitions[current].has(target); }

export function isEnterpriseSupportSessionStatus(
  value: unknown,
): value is EnterpriseSupportSessionStatus {
  return enterpriseSupportSessionStatuses.includes(
    value as EnterpriseSupportSessionStatus,
  );
}
