import type {
  CreateEnterpriseCampaignRequest,
  EnterpriseCampaignResponse,
  EnterpriseCampaignsResponse,
  EnterpriseCampaignLeadsResponse,
  EnterpriseLeadImportBatchesResponse,
  EnterpriseLeadImportRequest,
  EnterpriseLeadImportResponse,
  EnterpriseLeadImportRollbackResponse,
  EnterpriseMarketingConsentEligibilityResponse,
  EnterpriseMarketingConsentRevocationResponse,
  EnterpriseMarketingConsentResponse,
  EnterpriseMarketingConsentsResponse,
  RegisterEnterpriseMarketingConsentRequest,
  RevokeEnterpriseMarketingConsentRequest,
  RollbackEnterpriseLeadImportRequest,
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
  listCampaignLeads(context: EnterpriseContentRequestContext, campaignId: string):
    Promise<EnterpriseCampaignLeadsResponse>;
  listLeadImportBatches(context: EnterpriseContentRequestContext, campaignId: string):
    Promise<EnterpriseLeadImportBatchesResponse>;
  importCampaignLeads(context: EnterpriseContentRequestContext, campaignId: string,
    input: EnterpriseLeadImportRequest, idempotencyKey: string):
    Promise<EnterpriseLeadImportResponse>;
  rollbackLeadImport(context: EnterpriseContentRequestContext, campaignId: string,
    batchId: string, input: RollbackEnterpriseLeadImportRequest,
    idempotencyKey: string): Promise<EnterpriseLeadImportRollbackResponse>;
  listMarketingConsents(context: EnterpriseContentRequestContext, campaignId: string,
    leadId: string): Promise<EnterpriseMarketingConsentsResponse>;
  getMarketingConsentEligibility(context: EnterpriseContentRequestContext,
    campaignId: string, leadId: string):
    Promise<EnterpriseMarketingConsentEligibilityResponse>;
  registerMarketingConsent(context: EnterpriseContentRequestContext,
    campaignId: string, leadId: string,
    input: RegisterEnterpriseMarketingConsentRequest, idempotencyKey: string):
    Promise<EnterpriseMarketingConsentResponse>;
  revokeMarketingConsent(context: EnterpriseContentRequestContext,
    campaignId: string, leadId: string, consentId: string,
    input: RevokeEnterpriseMarketingConsentRequest, idempotencyKey: string):
    Promise<EnterpriseMarketingConsentRevocationResponse>;
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
    listCampaignLeads: (context, campaignId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/leads`,
      { headers: headers(context) },
    ),
    listLeadImportBatches: (context, campaignId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/lead-imports`,
      { headers: headers(context) },
    ),
    importCampaignLeads: (context, campaignId, input, key) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/lead-imports`,
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
    rollbackLeadImport: (context, campaignId, batchId, input, key) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/lead-imports/${
        encodeURIComponent(batchId)}/rollback`,
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
    listMarketingConsents: (context, campaignId, leadId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/leads/${
        encodeURIComponent(leadId)}/consents`,
      { headers: headers(context) },
    ),
    getMarketingConsentEligibility: (context, campaignId, leadId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/leads/${
        encodeURIComponent(leadId)}/consent-eligibility`,
      { headers: headers(context) },
    ),
    registerMarketingConsent: (context, campaignId, leadId, input, key) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/leads/${
        encodeURIComponent(leadId)}/consents`,
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
    revokeMarketingConsent: (context, campaignId, leadId, consentId, input, key) =>
      request(`${campaigns}/${encodeURIComponent(campaignId)}/leads/${
        encodeURIComponent(leadId)}/consents/${encodeURIComponent(consentId)}/revoke`,
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) }),
  };
}
