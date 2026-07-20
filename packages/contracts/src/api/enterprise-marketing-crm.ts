export type EnterpriseMarketingCrmProvider = "salesforce";
export type EnterpriseMarketingCrmSyncStatus = "pending" | "synced" | "failed";

export interface EnterpriseMarketingCrmSyncDto {
  id: string;
  campaignId: string;
  outcomeId: string;
  provider: EnterpriseMarketingCrmProvider;
  status: EnterpriseMarketingCrmSyncStatus;
  externalRecordKey: string;
  objectApiName: string;
  providerRecordId?: string;
  providerRecordUrl?: string;
  attempts: number;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  version: number;
}

export interface EnterpriseMarketingCrmSyncListResponse {
  campaignId: string;
  generatedAt: string;
  counts: { pending: number; synced: number; failed: number };
  syncs: EnterpriseMarketingCrmSyncDto[];
  truncated: boolean;
}

export interface CreateEnterpriseMarketingCrmSyncRequest {
  expectedOutcomeVersion: number;
}

export interface EnterpriseMarketingCrmSyncResponse {
  status: "created" | "replayed";
  sync: EnterpriseMarketingCrmSyncDto;
}
