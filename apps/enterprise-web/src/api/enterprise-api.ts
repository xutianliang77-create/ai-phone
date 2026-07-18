import type {
  EnterpriseContextResponse,
  EnterpriseClientEventRequest,
  EnterpriseClientEventResponse,
  EnterpriseKnowledgeSourceDto,
  EnterpriseKnowledgeSourceType,
  EnterpriseKnowledgeVersionDto,
  EnterpriseScriptTemplateDto,
  EnterpriseScriptTemplateVersionDto,
  EnterpriseTermEntryDto,
  EnterpriseTermPackDto,
  EnterpriseTermPackVersionDto,
  EnterpriseTerminologyPurpose,
  EnterpriseTenantListResponse,
  EnterpriseTenantJobResponse,
  EnterpriseTenantRouteDocument,
  PhoneCodeRequestResponse,
  PhoneLoginResponse,
} from "@translation/contracts";
import { createEnterpriseMemberApi, type EnterpriseMemberApi } from "./enterprise-member-api.js";
import { createEnterpriseSettingsApi, type EnterpriseSettingsApi } from "./enterprise-settings-api.js";
import { createEnterpriseAuditApi, type EnterpriseAuditApi } from "./enterprise-audit-api.js";
import {
  createEnterpriseMeetingApi,
  type EnterpriseMeetingApi,
} from "./enterprise-meeting-api.js";
import {
  configuredEnterpriseBaseUrl,
  createEnterpriseBinaryRequester,
  createEnterpriseRequester,
  enterpriseContentHeaders as contentHeaders,
} from "./enterprise-request.js";
export { EnterpriseApiError } from "./enterprise-api-error.js";

export interface EnterpriseContentRequestContext {
  token: string;
  tenantId: string;
  routeDocument: EnterpriseTenantRouteDocument;
}

export interface EnterpriseContentDimensions {
  countryCode: string;
  productCode: string;
}

export interface EnterprisePublicationInput {
  expectedVersion: number;
  effectiveFrom?: string;
  expiresAt?: string;
}

export interface EnterpriseApi extends EnterpriseMemberApi, EnterpriseSettingsApi,
  EnterpriseAuditApi, EnterpriseMeetingApi {
  requestCode(phone: string): Promise<PhoneCodeRequestResponse>;
  login(phone: string, code: string): Promise<PhoneLoginResponse>;
  listTenants(token: string): Promise<EnterpriseTenantListResponse>;
  getTenantRoute(token: string, tenantId: string): Promise<EnterpriseTenantRouteDocument>;
  getContext(token: string, tenantId: string): Promise<EnterpriseContextResponse>;
  getTenantJob(token: string, jobId: string): Promise<EnterpriseTenantJobResponse>;
  reportClientEvent(
    context: EnterpriseContentRequestContext,
    event: EnterpriseClientEventRequest,
  ): Promise<EnterpriseClientEventResponse>;
  listKnowledgeSources(context: EnterpriseContentRequestContext): Promise<{
    sources: EnterpriseKnowledgeSourceDto[];
  }>;
  createKnowledgeSource(
    context: EnterpriseContentRequestContext,
    input: { name: string; sourceType: EnterpriseKnowledgeSourceType },
  ): Promise<{ source: EnterpriseKnowledgeSourceDto }>;
  listKnowledgeVersions(
    context: EnterpriseContentRequestContext,
    sourceId: string,
  ): Promise<{ knowledgeVersions: EnterpriseKnowledgeVersionDto[] }>;
  createKnowledgeVersion(
    context: EnterpriseContentRequestContext,
    sourceId: string,
    input: EnterpriseContentDimensions & { locale: string },
  ): Promise<{ knowledgeVersion: EnterpriseKnowledgeVersionDto }>;
  stageKnowledgeVersion(
    context: EnterpriseContentRequestContext,
    versionId: string,
    input: { expectedVersion: number; chunks: Array<{ blockId: string; content: string }> },
  ): Promise<{ knowledgeVersion: EnterpriseKnowledgeVersionDto }>;
  publishKnowledgeVersion(
    context: EnterpriseContentRequestContext,
    versionId: string,
    input: EnterprisePublicationInput,
  ): Promise<{ knowledgeVersion: EnterpriseKnowledgeVersionDto }>;
  listTermPacks(context: EnterpriseContentRequestContext): Promise<{
    termPacks: EnterpriseTermPackDto[];
  }>;
  createTermPack(
    context: EnterpriseContentRequestContext,
    input: { name: string },
  ): Promise<{ termPack: EnterpriseTermPackDto }>;
  listTermPackVersions(
    context: EnterpriseContentRequestContext,
    packId: string,
  ): Promise<{ termPackVersions: EnterpriseTermPackVersionDto[] }>;
  createTermPackVersion(
    context: EnterpriseContentRequestContext,
    packId: string,
    input: EnterpriseContentDimensions & {
      sourceLocale: string;
      targetLocale: string;
      usageScope: EnterpriseTerminologyPurpose;
    },
  ): Promise<{ termPackVersion: EnterpriseTermPackVersionDto }>;
  stageTermPackVersion(
    context: EnterpriseContentRequestContext,
    versionId: string,
    input: { expectedVersion: number; terms: EnterpriseTermEntryDto[] },
  ): Promise<{ termPackVersion: EnterpriseTermPackVersionDto }>;
  publishTermPackVersion(
    context: EnterpriseContentRequestContext,
    versionId: string,
    input: EnterprisePublicationInput,
  ): Promise<{ termPackVersion: EnterpriseTermPackVersionDto }>;
  listScriptTemplates(context: EnterpriseContentRequestContext): Promise<{
    scriptTemplates: EnterpriseScriptTemplateDto[];
  }>;
  createScriptTemplate(
    context: EnterpriseContentRequestContext,
    input: { name: string; purpose: EnterpriseTerminologyPurpose },
  ): Promise<{ scriptTemplate: EnterpriseScriptTemplateDto }>;
  listScriptTemplateVersions(
    context: EnterpriseContentRequestContext,
    templateId: string,
  ): Promise<{ scriptTemplateVersions: EnterpriseScriptTemplateVersionDto[] }>;
  createScriptTemplateVersion(
    context: EnterpriseContentRequestContext,
    templateId: string,
    input: EnterpriseContentDimensions & { locale: string },
  ): Promise<{ scriptTemplateVersion: EnterpriseScriptTemplateVersionDto }>;
  stageScriptTemplateVersion(
    context: EnterpriseContentRequestContext,
    versionId: string,
    input: {
      expectedVersion: number;
      promptText: string;
      requiredPhrases: string[];
      prohibitedPhrases: string[];
      variables: string[];
    },
  ): Promise<{ scriptTemplateVersion: EnterpriseScriptTemplateVersionDto }>;
  publishScriptTemplateVersion(
    context: EnterpriseContentRequestContext,
    versionId: string,
    input: EnterprisePublicationInput,
  ): Promise<{ scriptTemplateVersion: EnterpriseScriptTemplateVersionDto }>;
  logout(token: string): Promise<void>;
}

export function createEnterpriseApi(
  fetcher: typeof fetch = fetch,
  baseUrl = configuredEnterpriseBaseUrl(),
): EnterpriseApi {
  const request = createEnterpriseRequester(fetcher, baseUrl);
  const binaryRequest = createEnterpriseBinaryRequester(fetcher, baseUrl);
  return {
    ...createEnterpriseMemberApi(request, contentHeaders),
    ...createEnterpriseSettingsApi(request, contentHeaders),
    ...createEnterpriseAuditApi(request, binaryRequest, contentHeaders),
    ...createEnterpriseMeetingApi(request, contentHeaders),
    requestCode: (phone) => request("/auth/phone/request-code", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
    login: (phone, code) => request("/auth/phone/login", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),
    listTenants: (token) => request("/enterprise/v1/tenants", {
      headers: authorization(token),
    }),
    getTenantRoute: (token, tenantId) => request(
      `/saas/v1/tenants/${encodeURIComponent(tenantId)}/route`,
      { headers: authorization(token) },
    ),
    getContext: (token, tenantId) => request("/enterprise/v1/me", {
      headers: { ...authorization(token), "x-tenant-id": tenantId },
    }),
    getTenantJob: (token, jobId) => request(
      `/saas/v1/tenant-jobs/${encodeURIComponent(jobId)}`,
      { headers: authorization(token) },
    ),
    reportClientEvent: (context, event) => request(
      "/enterprise/v1/observability/client-events",
      {
        method: "POST",
        headers: contentHeaders(context),
        body: JSON.stringify(event),
      },
    ),
    listKnowledgeSources: (context) => request(
      "/enterprise/v1/knowledge/sources",
      { headers: contentHeaders(context) },
    ),
    createKnowledgeSource: (context, input) => request(
      "/enterprise/v1/knowledge/sources",
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    listKnowledgeVersions: (context, sourceId) => request(
      `/enterprise/v1/knowledge/sources/${encodeURIComponent(sourceId)}/versions`,
      { headers: contentHeaders(context) },
    ),
    createKnowledgeVersion: (context, sourceId, input) => request(
      `/enterprise/v1/knowledge/sources/${encodeURIComponent(sourceId)}/versions`,
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    stageKnowledgeVersion: (context, versionId, input) => request(
      `/enterprise/v1/knowledge/versions/${encodeURIComponent(versionId)}/chunks`,
      { method: "PUT", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    publishKnowledgeVersion: (context, versionId, input) => request(
      `/enterprise/v1/knowledge/versions/${encodeURIComponent(versionId)}/publish`,
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    listTermPacks: (context) => request(
      "/enterprise/v1/terminology/packs",
      { headers: contentHeaders(context) },
    ),
    createTermPack: (context, input) => request(
      "/enterprise/v1/terminology/packs",
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    listTermPackVersions: (context, packId) => request(
      `/enterprise/v1/terminology/packs/${encodeURIComponent(packId)}/versions`,
      { headers: contentHeaders(context) },
    ),
    createTermPackVersion: (context, packId, input) => request(
      `/enterprise/v1/terminology/packs/${encodeURIComponent(packId)}/versions`,
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    stageTermPackVersion: (context, versionId, input) => request(
      `/enterprise/v1/terminology/pack-versions/${encodeURIComponent(versionId)}/content`,
      { method: "PUT", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    publishTermPackVersion: (context, versionId, input) => request(
      `/enterprise/v1/terminology/pack-versions/${encodeURIComponent(versionId)}/publish`,
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    listScriptTemplates: (context) => request(
      "/enterprise/v1/script-templates",
      { headers: contentHeaders(context) },
    ),
    createScriptTemplate: (context, input) => request(
      "/enterprise/v1/script-templates",
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    listScriptTemplateVersions: (context, templateId) => request(
      `/enterprise/v1/script-templates/${encodeURIComponent(templateId)}/versions`,
      { headers: contentHeaders(context) },
    ),
    createScriptTemplateVersion: (context, templateId, input) => request(
      `/enterprise/v1/script-templates/${encodeURIComponent(templateId)}/versions`,
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    stageScriptTemplateVersion: (context, versionId, input) => request(
      `/enterprise/v1/script-template-versions/${encodeURIComponent(versionId)}/content`,
      { method: "PUT", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    publishScriptTemplateVersion: (context, versionId, input) => request(
      `/enterprise/v1/script-template-versions/${encodeURIComponent(versionId)}/publish`,
      { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
    ),
    logout: async (token) => {
      await request("/auth/logout", {
        method: "POST",
        headers: authorization(token),
      });
    },
  };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

export const enterpriseApi = createEnterpriseApi();
