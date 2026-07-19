import type {
  CreateEnterpriseCampaignRequest,
  EnterpriseCampaignResponse,
  EnterpriseCampaignsResponse,
  UpdateEnterpriseCampaignRequest,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;
type Headers = (context: EnterpriseContentRequestContext) => Record<string, string>;

export interface EnterpriseCampaignApi {
  listCampaigns(context: EnterpriseContentRequestContext):
    Promise<EnterpriseCampaignsResponse>;
  getCampaign(context: EnterpriseContentRequestContext, campaignId: string):
    Promise<EnterpriseCampaignResponse>;
  createCampaign(context: EnterpriseContentRequestContext,
    input: CreateEnterpriseCampaignRequest, idempotencyKey: string):
    Promise<EnterpriseCampaignResponse>;
  updateCampaign(context: EnterpriseContentRequestContext, campaignId: string,
    input: UpdateEnterpriseCampaignRequest, idempotencyKey: string):
    Promise<EnterpriseCampaignResponse>;
  scheduleCampaign(context: EnterpriseContentRequestContext, campaignId: string,
    input: { expectedVersion: number }, idempotencyKey: string):
    Promise<EnterpriseCampaignResponse>;
}

export function createEnterpriseCampaignApi(
  request: Requester,
  headers: Headers,
): EnterpriseCampaignApi {
  const campaigns = "/enterprise/v1/campaigns";
  return {
    listCampaigns: (context) => request(campaigns, { headers: headers(context) }),
    getCampaign: (context, campaignId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}`,
      { headers: headers(context) },
    ),
    createCampaign: (context, input, key) => request(campaigns, {
      method: "POST", headers: { ...headers(context), "idempotency-key": key },
      body: JSON.stringify(input),
    }),
    updateCampaign: (context, campaignId, input, key) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}`,
      { method: "PATCH", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
    scheduleCampaign: (context, campaignId, input, key) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/schedule`,
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
  };
}
