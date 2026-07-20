import type { EnterpriseMarketingAnalyticsResponse } from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";
import { configuredEnterpriseBaseUrl, createEnterpriseRequester,
  enterpriseContentHeaders } from "./enterprise-request.js";

export interface EnterpriseMarketingAnalyticsApi {
  get(context: EnterpriseContentRequestContext, campaignId: string):
    Promise<EnterpriseMarketingAnalyticsResponse>;
}

export const enterpriseMarketingAnalyticsApi: EnterpriseMarketingAnalyticsApi = (() => {
  const request = createEnterpriseRequester(fetch, configuredEnterpriseBaseUrl());
  return { get: (context, campaignId) => request(
    `/enterprise/v1/campaigns/${encodeURIComponent(campaignId)}/analytics`,
    { headers: enterpriseContentHeaders(context) },
  ) };
})();
