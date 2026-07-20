import type { EnterpriseCampaignDto } from "./enterprise-campaign.js";

export type EnterpriseCampaignValidationIssueCode =
  | "schedule_start_required"
  | "schedule_start_elapsed"
  | "campaign_has_no_active_leads"
  | "marketing_handoff_policy_missing"
  | "marketing_handoff_resource_not_ready"
  | "country_policy_missing"
  | "country_policy_not_yet_effective"
  | "country_policy_expired"
  | "lead_country_mismatch"
  | "lead_timezone_invalid"
  | "consent_missing"
  | "target_suppressed";

export interface EnterpriseCampaignValidationIssue {
  code: EnterpriseCampaignValidationIssueCode;
  countryCode?: string;
  leadId?: string;
}

export interface EnterpriseCampaignApprovalPolicyRef {
  countryCode: string;
  policyId: string;
  policyVersion: string;
  contentHash: string;
  effectiveFrom: string;
  expiresAt: string;
}

export interface EnterpriseCampaignApprovalDataSnapshot {
  leadCount: number;
  leadSetHash: string;
  consentCount: number;
  consentSetHash: string;
  suppressionCount: number;
  suppressionSetHash: string;
}

export interface EnterpriseCampaignValidationSnapshotDto {
  id: string;
  campaignId: string;
  sourceCampaignVersion: number;
  status: "ready" | "blocked";
  targetAt?: string;
  campaignHash: string;
  policies: EnterpriseCampaignApprovalPolicyRef[];
  policySetHash: string;
  dataSnapshot: EnterpriseCampaignApprovalDataSnapshot;
  issues: EnterpriseCampaignValidationIssue[];
  snapshotHash: string;
  validatedBy: string;
  validatedAt: string;
  version: number;
}

export interface EnterpriseCampaignApprovalDecisionDto {
  id: string;
  campaignId: string;
  validationSnapshotId: string;
  decision: "approved" | "rejected";
  rejectionReason?: string;
  decisionHash: string;
  decidedBy: string;
  decidedAt: string;
  version: number;
}

export interface ValidateEnterpriseCampaignRequest {
  tenantId?: string;
  expectedVersion: number;
}

export interface DecideEnterpriseCampaignRequest {
  tenantId?: string;
  expectedVersion: number;
  validationSnapshotId: string;
}

export interface RejectEnterpriseCampaignRequest extends
  DecideEnterpriseCampaignRequest {
  reason: string;
}

export interface EnterpriseCampaignValidationResponse {
  validation: EnterpriseCampaignValidationSnapshotDto;
  campaign?: EnterpriseCampaignDto;
  replayed?: true;
}

export interface EnterpriseCampaignApprovalDecisionResponse {
  decision: EnterpriseCampaignApprovalDecisionDto;
  campaign: EnterpriseCampaignDto;
  replayed?: true;
}

export interface EnterpriseCampaignApprovalDetailResponse {
  latestValidation?: EnterpriseCampaignValidationSnapshotDto;
  decisions: EnterpriseCampaignApprovalDecisionDto[];
}
