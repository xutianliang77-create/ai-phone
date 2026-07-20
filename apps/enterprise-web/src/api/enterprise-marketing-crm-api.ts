import type { EnterpriseMarketingCrmSyncListResponse,
  EnterpriseMarketingCrmSyncResponse } from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";
import { configuredEnterpriseBaseUrl, createEnterpriseRequester,
  enterpriseContentHeaders } from "./enterprise-request.js";

export interface EnterpriseMarketingCrmApi {
  list(context: EnterpriseContentRequestContext, campaignId: string):
    Promise<EnterpriseMarketingCrmSyncListResponse>;
  request(context: EnterpriseContentRequestContext, campaignId: string,
    outcomeId: string, expectedOutcomeVersion: number, key: string):
    Promise<EnterpriseMarketingCrmSyncResponse>;
}

export const enterpriseMarketingCrmApi: EnterpriseMarketingCrmApi = (() => {
  const request = createEnterpriseRequester(fetch, configuredEnterpriseBaseUrl());
  const path = (campaignId: string, suffix: string) =>
    `/enterprise/v1/campaigns/${encodeURIComponent(campaignId)}${suffix}`;
  return {
    list: (context, campaignId) => request(path(campaignId, "/crm-syncs"),
      { headers: enterpriseContentHeaders(context) }),
    request: (context, campaignId, outcomeId, expectedOutcomeVersion, key) => request(
      path(campaignId, `/outcomes/${encodeURIComponent(outcomeId)}/crm-sync`), {
        method: "POST", headers: { ...enterpriseContentHeaders(context),
          "idempotency-key": key }, body: JSON.stringify({ expectedOutcomeVersion }) }),
  };
})();
