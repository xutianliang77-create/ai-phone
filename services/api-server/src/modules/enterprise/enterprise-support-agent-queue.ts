export const enterpriseSupportAgentClaimStatuses = [
  "active", "released", "reassigned", "expired",
] as const;
export type EnterpriseSupportAgentClaimStatus =
  typeof enterpriseSupportAgentClaimStatuses[number];

export const enterpriseSupportAgentReleaseReasons = [
  "agent_release", "agent_disconnect", "manager_release",
  "reassigned", "lease_expired",
] as const;
export type EnterpriseSupportAgentReleaseReason =
  typeof enterpriseSupportAgentReleaseReasons[number];

export interface EnterpriseSupportAgentClaimRecord {
  id: string;
  tenantId: string;
  supportSessionId: string;
  queueId: string;
  agentUserId: string;
  status: EnterpriseSupportAgentClaimStatus;
  idempotencyKey: string;
  requestHash: string;
  reassignedFromClaimId?: string;
  claimedAt: string;
  leaseExpiresAt: string;
  releasedAt?: string;
  releasedBy?: string;
  releaseReason?: EnterpriseSupportAgentReleaseReason;
  releaseIdempotencyKey?: string;
  releaseRequestHash?: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseSupportQueueWorkItem {
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
  expiredClaimId?: string;
}

export function isEnterpriseSupportAgentReleaseReason(
  value: unknown,
): value is EnterpriseSupportAgentReleaseReason {
  return enterpriseSupportAgentReleaseReasons.includes(
    value as EnterpriseSupportAgentReleaseReason,
  );
}
