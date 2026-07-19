import type {
  CreateEnterpriseCampaignRequest,
  CreateEnterpriseMarketingSuppressionRequest,
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
  EnterpriseMarketingSuppressionEligibilityResponse,
  EnterpriseMarketingSuppressionResponse,
  EnterpriseMarketingSuppressionsResponse,
  EnterpriseCountryPoliciesResponse,
  EnterpriseCountryPolicyResponse,
  EnterpriseCampaignCountryPolicyReadinessResponse,
  PublishEnterpriseCountryPolicyRequest,
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
  listMarketingSuppressions(context: EnterpriseContentRequestContext,
    campaignId: string, leadId: string):
    Promise<EnterpriseMarketingSuppressionsResponse>;
  getMarketingSuppressionEligibility(context: EnterpriseContentRequestContext,
    campaignId: string, leadId: string):
    Promise<EnterpriseMarketingSuppressionEligibilityResponse>;
  createMarketingSuppression(context: EnterpriseContentRequestContext,
    input: CreateEnterpriseMarketingSuppressionRequest, idempotencyKey: string):
    Promise<EnterpriseMarketingSuppressionResponse>;
  listCountryPolicies(context: EnterpriseContentRequestContext):
    Promise<EnterpriseCountryPoliciesResponse>;
  publishCountryPolicy(context: EnterpriseContentRequestContext,
    input: PublishEnterpriseCountryPolicyRequest, idempotencyKey: string):
    Promise<EnterpriseCountryPolicyResponse>;
  getCampaignCountryPolicyReadiness(context: EnterpriseContentRequestContext,
    campaignId: string): Promise<EnterpriseCampaignCountryPolicyReadinessResponse>;
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
    listMarketingSuppressions: (context, campaignId, leadId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/leads/${
        encodeURIComponent(leadId)}/suppressions`,
      { headers: headers(context) },
    ),
    getMarketingSuppressionEligibility: (context, campaignId, leadId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/leads/${
        encodeURIComponent(leadId)}/suppression-eligibility`,
      { headers: headers(context) },
    ),
    createMarketingSuppression: (context, input, key) => request(
      "/enterprise/v1/suppression",
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
    listCountryPolicies: (context) => request(
      "/enterprise/v1/marketing/country-policies",
      { headers: headers(context) },
    ),
    publishCountryPolicy: (context, input, key) => request(
      "/enterprise/v1/marketing/country-policies",
      { method: "POST", headers: { ...headers(context), "idempotency-key": key },
        body: JSON.stringify(input) },
    ),
    getCampaignCountryPolicyReadiness: (context, campaignId) => request(
      `${campaigns}/${encodeURIComponent(campaignId)}/country-policy-readiness`,
      { headers: headers(context) },
    ),
  };
}
