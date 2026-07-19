import type { EnterpriseSupportRagResponse } from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type EnterpriseRequester = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface EnterpriseSupportQueueDto {
  id: string;
  name: string;
  status: "active" | "paused" | "disabled";
  defaultPriority: number;
  handoffSlaSeconds: number;
  claimLeaseSeconds: number;
  version: number;
}

export interface EnterpriseSupportWorkItemDto {
  sessionId: string;
  queueId: string;
  customerId: string;
  priority: number;
  intent?: string;
  status: "handoff_requested" | "claim_expired";
  handoffRequestedAt: string;
  slaDeadlineAt: string;
  slaBreached: boolean;
  waitSeconds: number;
  expectedSessionVersion: number;
}

export interface EnterpriseSupportClaimDto {
  id: string;
  queueId: string;
  agentUserId: string;
  status: "active" | "released" | "reassigned" | "expired";
  claimedAt: string;
  leaseExpiresAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseSupportSessionDto {
  id: string;
  status: string;
  intent?: string;
  priority: number;
  queueId?: string;
  assignedUserId?: string;
  createdAt: string;
  queuedAt?: string;
  handoffRequestedAt?: string;
  assignedAt?: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseSupportFollowupDto {
  id: string; kind: "ticket" | "callback";
  status: "processing" | "completed" | "failed";
  caseId?: string; callbackId?: string; providerSimulated: boolean;
  attempts: number; failureCode?: string; createdAt: string;
  updatedAt: string; completedAt?: string; version?: number;
}

export interface EnterpriseSupportWorkbenchDto {
  generatedAt: string;
  session: EnterpriseSupportSessionDto;
  claim: EnterpriseSupportClaimDto;
  aiSpeechFence: {
    status: "stopped" | "not_started" | "terminal";
    verifiedAt: string;
    runId?: string;
    runStatus?: string;
  };
  channel: { channelType: string; provider: string; status: string };
  customer: {
    id: string; externalId?: string; displayName?: string; locale?: string;
    attributes: Record<string, unknown>; consentScope: string[]; updatedAt: string;
  };
  queue?: {
    id: string; name: string; status: string; handoffSlaSeconds: number;
    claimLeaseSeconds: number;
  };
  communication?: {
    sessionId: string; status: string; generation: number; updatedAt: string;
  };
  cases: Array<{
    id: string; subject: string; status: string; summary?: string;
    resolution?: string; externalTicketId?: string; createdAt: string;
    updatedAt: string;
  }>;
  callbacks: Array<{
    id: string; scheduledAt: string; reason: string;
    status: "dispatch_pending" | "scheduled" | "failed" | "cancelled" | "completed";
    externalCallbackId?: string; failureCode?: string; createdAt: string;
    updatedAt: string; completedAt?: string;
  }>;
  followups: EnterpriseSupportFollowupDto[];
  toolExecutions: Array<{
    id: string; toolName: string; riskLevel: string;
    confirmationStatus: string; status: string; resultDocument?: unknown;
    failureCode?: string; createdAt: string; completedAt?: string; updatedAt: string;
  }>;
  agent?: {
    runId: string; status: string; locale: string; countryCode: string;
    productCode: string; conversationState: string; generation: number;
    updatedAt: string;
  };
  conversationContext: Array<{ role: "customer" | "assistant"; text: string }>;
  agentTurns: Array<{
    id: string; sequence: number; status: string; spokenText: string;
    intent: string; riskSignals: string[]; knowledgeCitations: string[];
    createdAt: string; updatedAt: string;
  }>;
  highRiskHandoffs: Array<{
    id: string; toolName: string; riskCategory: string;
    policyVersion: string; createdAt: string;
  }>;
  transcriptSegments: Array<{
    segmentId: string; revision: number; sourceText: string;
    translatedText?: string; sourceLanguage?: string; targetLanguage?: string;
    speakerId?: string; speakerRole?: string; startMs?: number; endMs?: number;
    createdAt: string; updatedAt: string;
  }>;
  controls: Record<string, { status: "ready" | "forbidden" | "not_ready";
    reasonCode?: string; simulated?: boolean }>;
}

export interface EnterpriseSupportApi {
  listSupportQueues(context: EnterpriseContentRequestContext): Promise<{
    queues: EnterpriseSupportQueueDto[];
  }>;
  listSupportWorkItems(
    context: EnterpriseContentRequestContext,
    queueId: string,
  ): Promise<{ status: "ready"; workItems: EnterpriseSupportWorkItemDto[] }>;
  claimSupportSession(
    context: EnterpriseContentRequestContext,
    sessionId: string,
    input: { expectedSessionVersion: number; idempotencyKey: string },
  ): Promise<{ status: "claimed" | "replayed"; claim: EnterpriseSupportClaimDto;
    session: EnterpriseSupportSessionDto }>;
  activateSupportWorkbench(
    context: EnterpriseContentRequestContext,
    sessionId: string,
  ): Promise<EnterpriseSupportWorkbenchDto>;
  getSupportWorkbench(
    context: EnterpriseContentRequestContext,
    sessionId: string,
  ): Promise<EnterpriseSupportWorkbenchDto>;
  renewSupportClaim(
    context: EnterpriseContentRequestContext,
    claimId: string,
    expectedClaimVersion: number,
  ): Promise<{ claim: EnterpriseSupportClaimDto }>;
  releaseSupportClaim(
    context: EnterpriseContentRequestContext,
    claimId: string,
    input: { expectedClaimVersion: number; expectedSessionVersion: number;
      idempotencyKey: string; reason: "agent_release" | "agent_disconnect" },
  ): Promise<{ status: "released" | "replayed"; claim: EnterpriseSupportClaimDto;
    session: EnterpriseSupportSessionDto }>;
  createSupportTicket(
    context: EnterpriseContentRequestContext, sessionId: string,
    input: { subject: string; description: string; idempotencyKey: string;
      expectedSessionVersion: number; expectedClaimVersion: number },
  ): Promise<{ status: "processing" | "replayed";
    followup: EnterpriseSupportFollowupDto }>;
  scheduleSupportCallback(
    context: EnterpriseContentRequestContext, sessionId: string,
    input: { scheduledAt: string; reason: string; idempotencyKey: string;
      expectedSessionVersion: number; expectedClaimVersion: number },
  ): Promise<{ status: "processing" | "replayed";
    followup: EnterpriseSupportFollowupDto }>;
  resolveSupportKnowledge(
    context: EnterpriseContentRequestContext,
    sessionId: string,
    input: { query: string; locale: string; countryCode: string;
      productCode: string; limit?: number },
  ): Promise<{ resolution: EnterpriseSupportRagResponse }>;
}

export function createEnterpriseSupportApi(
  request: EnterpriseRequester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseSupportApi {
  const sessionPath = (sessionId: string) =>
    `/enterprise/v1/support/sessions/${encodeURIComponent(sessionId)}`;
  return {
    listSupportQueues: (context) => request("/enterprise/v1/support/queues", {
      headers: headers(context),
    }),
    listSupportWorkItems: (context, queueId) => request(
      `/enterprise/v1/support/queues/${encodeURIComponent(queueId)}/work-items`,
      { headers: headers(context) },
    ),
    claimSupportSession: (context, sessionId, input) => request(
      `${sessionPath(sessionId)}/claims`,
      { method: "POST", headers: headers(context), body: JSON.stringify(input) },
    ),
    activateSupportWorkbench: (context, sessionId) => request(
      `${sessionPath(sessionId)}/workbench`,
      { method: "POST", headers: headers(context), body: JSON.stringify({}) },
    ),
    getSupportWorkbench: (context, sessionId) => request(
      `${sessionPath(sessionId)}/workbench`, { headers: headers(context) },
    ),
    renewSupportClaim: (context, claimId, expectedClaimVersion) => request(
      `/enterprise/v1/support/claims/${encodeURIComponent(claimId)}/renew`,
      { method: "POST", headers: headers(context),
        body: JSON.stringify({ expectedClaimVersion }) },
    ),
    releaseSupportClaim: (context, claimId, input) => request(
      `/enterprise/v1/support/claims/${encodeURIComponent(claimId)}/release`,
      { method: "POST", headers: headers(context), body: JSON.stringify(input) },
    ),
    createSupportTicket: (context, sessionId, input) => request(
      `${sessionPath(sessionId)}/followups/tickets`,
      { method: "POST", headers: headers(context), body: JSON.stringify(input) },
    ),
    scheduleSupportCallback: (context, sessionId, input) => request(
      `${sessionPath(sessionId)}/followups/callbacks`,
      { method: "POST", headers: headers(context), body: JSON.stringify(input) },
    ),
    resolveSupportKnowledge: (context, sessionId, input) => request(
      `${sessionPath(sessionId)}/rag`,
      { method: "POST", headers: headers(context), body: JSON.stringify(input) },
    ),
  };
}
