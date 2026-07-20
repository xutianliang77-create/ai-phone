import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";

export interface EnterpriseMarketingCrmProviderResult {
  status: "completed" | "retry" | "failed";
  reasonCode?: string; providerRecordId?: string; providerRecordUrl?: string;
  providerResponseHash?: string;
}

export interface EnterpriseMarketingCrmProviderAdapter {
  readonly provider: "salesforce";
  readonly boundTenantId: string | null;
  readonly objectApiName: string | null;
  readonly fingerprint: string | null;
  upsert(payload: EnterpriseMarketingCrmPayload):
    Promise<EnterpriseMarketingCrmProviderResult>;
}
