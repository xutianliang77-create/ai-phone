import type {
  EnterpriseMarketingCrmProvider,
  EnterpriseMarketingCrmSyncStatus,
} from "@translation/contracts";

export interface EnterpriseMarketingCrmSyncRecord {
  id: string; tenantId: string; campaignId: string; outcomeId: string;
  provider: EnterpriseMarketingCrmProvider; status: EnterpriseMarketingCrmSyncStatus;
  externalRecordKey: string; objectApiName: string; payloadHash: string;
  providerFingerprint: string; requestHash: string; idempotencyKey: string;
  outboxEventId: string; providerRecordId?: string; providerRecordUrl?: string;
  providerResponseHash?: string; attempts: number; lastErrorCode?: string;
  createdBy: string; createdAt: string; updatedAt: string; syncedAt?: string;
  version: number;
}

export interface EnterpriseMarketingCrmPayload {
  v: 1; tenantId: string; syncId: string; campaignId: string; outcomeId: string;
  externalRecordKey: string; disposition: string; intentLevel: string;
  summary: string; evidenceHash: string; sourceHash: string; leadId: string;
  phoneHint: string; nextAction?: { kind: string; dueAt?: string };
  outcomeCreatedAt: string;
}

export interface EnterpriseMarketingCrmOutboxPayload {
  v: 1; tenantId: string; syncId: string; campaignId: string; outcomeId: string;
  provider: "salesforce"; externalRecordKey: string; objectApiName: string;
  providerFingerprint: string; payloadHash: string; sealedPayload: string;
}

export type EnterpriseMarketingCrmPublishReceipt =
  | { kind: "marketing_crm"; outcome: "synced"; syncId: string;
      providerRecordId: string; providerRecordUrl: string;
      providerResponseHash: string }
  | { kind: "marketing_crm"; outcome: "failed"; syncId: string;
      reasonCode: string };
