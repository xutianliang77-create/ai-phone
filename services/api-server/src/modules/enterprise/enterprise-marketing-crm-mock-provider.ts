import { createHash } from "node:crypto";
import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";
import type { EnterpriseMarketingCrmProviderAdapter } from
  "./enterprise-marketing-crm-provider.js";

export function createMockEnterpriseMarketingCrmProvider(input: {
  boundTenantId: string; objectApiName?: string;
}): EnterpriseMarketingCrmProviderAdapter & { uniqueRecordCount(): number } {
  const objectApiName = input.objectApiName ?? "Wujie_Marketing_Outcome__c";
  const fingerprint = createHash("sha256").update(JSON.stringify({
    boundTenantId: input.boundTenantId, objectApiName, mock: true })).digest("hex");
  const records = new Map<string, EnterpriseMarketingCrmPayload>();
  return { provider: "salesforce", boundTenantId: input.boundTenantId,
    objectApiName, fingerprint,
    async upsert(payload) {
      if (payload.tenantId !== input.boundTenantId) return { status: "failed",
        reasonCode: "crm_provider_tenant_mismatch" };
      records.set(payload.externalRecordKey, payload);
      const digest = createHash("sha256").update(payload.externalRecordKey).digest("hex");
      return { status: "completed", providerRecordId: `a00${digest.slice(0, 15)}`,
        providerRecordUrl: `https://example.my.salesforce.com/lightning/r/${
          objectApiName}/a00${digest.slice(0, 15)}/view`,
        providerResponseHash: createHash("sha256").update(JSON.stringify(payload))
          .digest("hex") };
    },
    uniqueRecordCount() { return records.size; } };
}
