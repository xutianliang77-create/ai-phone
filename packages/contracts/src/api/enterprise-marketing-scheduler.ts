import type { EnterpriseCampaignStatus } from "./enterprise-campaign.js";

export type EnterpriseMarketingTaskStatus =
  | "pending" | "scheduled" | "dispatching" | "dispatched" | "answered"
  | "retry" | "completed" | "failed" | "cancelled";

export interface EnterpriseMarketingTaskCounts {
  total: number;
  pending: number;
  scheduled: number;
  dispatching: number;
  dispatched: number;
  answered: number;
  retry: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface EnterpriseMarketingSchedulerStatusDto {
  campaignId: string;
  campaignStatus: EnterpriseCampaignStatus;
  state: "not_materialized" | "waiting" | "runnable" | "active" |
    "capacity_blocked" | "budget_blocked" | "complete";
  tasks: EnterpriseMarketingTaskCounts;
  nextDueAt?: string;
  activeClaims: number;
  tenantActiveClaims: number;
  campaignConcurrencyLimit: number;
  tenantConcurrencyLimit?: number;
  budgetStatus: "ready" | "not_configured" | "paused";
}

export interface EnterpriseMarketingSchedulerStatusResponse {
  scheduler: EnterpriseMarketingSchedulerStatusDto;
}

export interface EnterpriseMarketingSchedulerClaimRequest {
  tenantId: string;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
  routeDocument: string;
  schedulerId: string;
  batchSize: number;
}

export interface EnterpriseMarketingSchedulerClaimedTaskDto {
  id: string;
  campaignId: string;
  leadId: string;
  scheduledAt: string;
  attempt: number;
  approvalSnapshotId: string;
  countryPolicyVersionId: string;
  usageHoldId: string;
  claimToken: string;
  leaseExpiresAt: string;
  dispatchGeneration: number;
  version: number;
}

export interface EnterpriseMarketingSchedulerClaimResponse {
  status: "claimed" | "empty";
  tasks: EnterpriseMarketingSchedulerClaimedTaskDto[];
  capacitySkipped: number;
  budgetBlocked?: "not_configured" | "paused" | "exhausted";
}
