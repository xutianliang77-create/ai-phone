import type {
  EnterpriseContextResponse,
  EnterpriseKnowledgeSourceDto,
  EnterpriseKnowledgeSourceType,
  EnterpriseKnowledgeVersionDto,
  EnterpriseProviderCapabilitiesResponse,
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

export class EnterpriseApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "EnterpriseApiError";
  }
}

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

export interface EnterpriseApi extends EnterpriseMemberApi {
  requestCode(phone: string): Promise<PhoneCodeRequestResponse>;
  login(phone: string, code: string): Promise<PhoneLoginResponse>;
  listTenants(token: string): Promise<EnterpriseTenantListResponse>;
  getTenantRoute(token: string, tenantId: string): Promise<EnterpriseTenantRouteDocument>;
  getProviderCapabilities(
    token: string,
    tenantId: string,
  ): Promise<EnterpriseProviderCapabilitiesResponse>;
  getContext(token: string, tenantId: string): Promise<EnterpriseContextResponse>;
  getTenantJob(token: string, jobId: string): Promise<EnterpriseTenantJobResponse>;
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
  baseUrl = configuredBaseUrl(),
): EnterpriseApi {
  const request = createRequester(fetcher, baseUrl);
  return {
    ...createEnterpriseMemberApi(request, contentHeaders),
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
    getProviderCapabilities: (token, tenantId) => request(
      "/enterprise/v1/provider-capabilities",
      { headers: { ...authorization(token), "x-tenant-id": tenantId } },
    ),
    getContext: (token, tenantId) => request("/enterprise/v1/me", {
      headers: { ...authorization(token), "x-tenant-id": tenantId },
    }),
    getTenantJob: (token, jobId) => request(
      `/saas/v1/tenant-jobs/${encodeURIComponent(jobId)}`,
      { headers: authorization(token) },
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

function createRequester(fetcher: typeof fetch, baseUrl: string) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher(`${trimTrailingSlash(baseUrl)}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const payload = await readJson(response);
      if (!response.ok) throw apiError(response.status, payload);
      return payload as T;
    } finally {
      window.clearTimeout(timeout);
    }
  };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

function contentHeaders(context: EnterpriseContentRequestContext) {
  return {
    ...authorization(context.token),
    "x-tenant-id": context.tenantId,
    "x-enterprise-route-document": encodeRouteDocument(context.routeDocument),
  };
}

function encodeRouteDocument(document: EnterpriseTenantRouteDocument) {
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EnterpriseApiError(response.status, "invalid_response", "Invalid API response");
  }
}

function apiError(status: number, payload: unknown) {
  if (isErrorPayload(payload)) {
    return new EnterpriseApiError(
      status,
      payload.error.code,
      payload.error.message,
      payload.error.traceId,
    );
  }
  return new EnterpriseApiError(status, "request_failed", "Enterprise API request failed");
}

function isErrorPayload(payload: unknown): payload is {
  error: { code: string; message: string; traceId?: string };
} {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return false;
  const error = payload.error;
  return Boolean(error && typeof error === "object" && "code" in error &&
    "message" in error && typeof error.code === "string" &&
    typeof error.message === "string" &&
    (!("traceId" in error) || typeof error.traceId === "string"));
}

function configuredBaseUrl() {
  return import.meta.env.VITE_ENTERPRISE_API_BASE_URL?.trim() || "/api";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export const enterpriseApi = createEnterpriseApi();
