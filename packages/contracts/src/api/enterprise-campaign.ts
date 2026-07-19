export type EnterpriseCampaignStatus =
  | "draft"
  | "validating"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type EnterpriseCampaignApprovalStatus =
  | "not_submitted"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export interface EnterpriseCampaignScheduleDto {
  timezone: string;
  startAt?: string;
  endAt?: string;
}

export interface EnterpriseCampaignDto {
  id: string;
  name: string;
  objective: string;
  ownerUserId: string;
  countryCodes: string[];
  languageCodes: string[];
  status: EnterpriseCampaignStatus;
  approvalStatus: EnterpriseCampaignApprovalStatus;
  approvalSnapshotId?: string;
  policyVersion?: string;
  schedule: EnterpriseCampaignScheduleDto;
  concurrencyLimit: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateEnterpriseCampaignRequest {
  tenantId?: string;
  name: string;
  objective: string;
  countryCodes: string[];
  languageCodes: string[];
  schedule: EnterpriseCampaignScheduleDto;
  concurrencyLimit: number;
}

export interface UpdateEnterpriseCampaignRequest {
  tenantId?: string;
  expectedVersion: number;
  name?: string;
  objective?: string;
  countryCodes?: string[];
  languageCodes?: string[];
  schedule?: EnterpriseCampaignScheduleDto;
  concurrencyLimit?: number;
}

export interface EnterpriseCampaignResponse {
  campaign: EnterpriseCampaignDto;
  replayed?: boolean;
}

export interface EnterpriseCampaignsResponse {
  campaigns: EnterpriseCampaignDto[];
}
