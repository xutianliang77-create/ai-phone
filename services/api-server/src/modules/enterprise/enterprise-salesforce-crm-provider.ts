import { createHash } from "node:crypto";
import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";
import type { EnterpriseMarketingCrmProviderAdapter,
  EnterpriseMarketingCrmProviderResult } from "./enterprise-marketing-crm-provider.js";

export interface EnterpriseSalesforceCrmConfiguration {
  boundTenantId: string; loginUrl: string; clientId: string; clientSecret: string;
  apiVersion: string; objectApiName: string; externalIdField: string;
  payloadField: string; fingerprint: string;
}

export function loadEnterpriseSalesforceCrmConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseSalesforceCrmConfiguration | null {
  if (env.ENTERPRISE_CRM_PROVIDER?.trim() !== "salesforce") return null;
  const boundTenantId = validUuid(env.ENTERPRISE_SALESFORCE_TENANT_ID);
  const loginUrl = salesforceUrl(env.ENTERPRISE_SALESFORCE_LOGIN_URL);
  const clientId = secret(env.ENTERPRISE_SALESFORCE_CLIENT_ID);
  const clientSecret = secret(env.ENTERPRISE_SALESFORCE_CLIENT_SECRET);
  const apiVersion = /^v[0-9]{2}\.[0-9]$/.test(env.ENTERPRISE_SALESFORCE_API_VERSION?.trim()
    ?? "") ? env.ENTERPRISE_SALESFORCE_API_VERSION!.trim() : null;
  const objectApiName = apiName(env.ENTERPRISE_SALESFORCE_OBJECT_API_NAME);
  const externalIdField = apiName(env.ENTERPRISE_SALESFORCE_EXTERNAL_ID_FIELD);
  const payloadField = apiName(env.ENTERPRISE_SALESFORCE_PAYLOAD_FIELD);
  if (!boundTenantId || !loginUrl || !clientId || !clientSecret || !apiVersion ||
    !objectApiName || !externalIdField || !payloadField) return null;
  return { boundTenantId, loginUrl, clientId, clientSecret, apiVersion,
    objectApiName, externalIdField, payloadField,
    fingerprint: createHash("sha256").update(JSON.stringify({ boundTenantId,
      loginUrl, apiVersion, objectApiName, externalIdField, payloadField }))
      .digest("hex") };
}

export function createEnvironmentEnterpriseSalesforceCrmProvider(options: {
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch;
} = {}): EnterpriseMarketingCrmProviderAdapter {
  const config = loadEnterpriseSalesforceCrmConfiguration(options.env);
  if (!config) return unavailable();
  return new SalesforceAdapter(config, options.fetch ?? fetch);
}

class SalesforceAdapter implements EnterpriseMarketingCrmProviderAdapter {
  readonly provider = "salesforce" as const;
  readonly boundTenantId: string; readonly objectApiName: string;
  readonly fingerprint: string;
  constructor(private readonly config: EnterpriseSalesforceCrmConfiguration,
    private readonly request: typeof fetch) {
    this.boundTenantId = config.boundTenantId; this.objectApiName = config.objectApiName;
    this.fingerprint = config.fingerprint;
  }
  async upsert(payload: EnterpriseMarketingCrmPayload) {
    if (payload.tenantId !== this.boundTenantId) return failed(
      "crm_provider_tenant_mismatch");
    let token = await this.token(); if (!token) return retry("crm_oauth_unavailable");
    let result = await this.upsertWithToken(payload, token);
    if (result === "unauthorized") {
      token = await this.token(); if (!token) return retry("crm_oauth_unavailable");
      result = await this.upsertWithToken(payload, token);
    }
    return result === "unauthorized" ? retry("crm_oauth_rejected") : result;
  }
  private async token() {
    try {
      const body = new URLSearchParams({ grant_type: "client_credentials",
        client_id: this.config.clientId, client_secret: this.config.clientSecret });
      const response = await this.request(`${this.config.loginUrl}/services/oauth2/token`,
        { method: "POST", headers: { "content-type":
          "application/x-www-form-urlencoded" }, body });
      if (!response.ok) return null;
      const value = await response.json() as Record<string, unknown>;
      const accessToken = secret(value.access_token); const instanceUrl =
        salesforceUrl(value.instance_url);
      return accessToken && instanceUrl ? { accessToken, instanceUrl } : null;
    } catch { return null; }
  }
  private async upsertWithToken(payload: EnterpriseMarketingCrmPayload,
    token: { accessToken: string; instanceUrl: string }): Promise<
      EnterpriseMarketingCrmProviderResult | "unauthorized"> {
    const path = this.recordPath(payload.externalRecordKey);
    const serialized = JSON.stringify(providerPayload(payload));
    try {
      const response = await this.request(`${token.instanceUrl}${path}`, {
        method: "PATCH", headers: auth(token.accessToken),
        body: JSON.stringify({ [this.config.payloadField]: serialized }),
      });
      if (response.status === 401) return "unauthorized";
      if (!response.ok) return transient(response.status)
        ? retry("crm_provider_temporarily_unavailable")
        : failed("crm_provider_request_rejected");
      return this.reconcile(payload.externalRecordKey, serialized, token);
    } catch { return retry("crm_provider_transport_failed"); }
  }
  private async reconcile(externalKey: string, serialized: string,
    token: { accessToken: string; instanceUrl: string }) {
    try {
      const fields = ["Id", this.config.externalIdField, this.config.payloadField].join(",");
      const response = await this.request(`${token.instanceUrl}${
        this.recordPath(externalKey)}?fields=${encodeURIComponent(fields)}`,
      { headers: auth(token.accessToken, false) });
      if (response.status === 401) return "unauthorized" as const;
      if (!response.ok) return transient(response.status)
        ? retry("crm_provider_reconcile_unavailable")
        : failed("crm_provider_reconcile_rejected");
      const body = await response.json() as Record<string, unknown>;
      const recordId = typeof body.Id === "string" && /^[A-Za-z0-9]{15,18}$/.test(body.Id)
        ? body.Id : null;
      if (!recordId || body[this.config.externalIdField] !== externalKey ||
        body[this.config.payloadField] !== serialized) return retry(
          "crm_provider_reconcile_mismatch");
      return { status: "completed" as const, providerRecordId: recordId,
        providerRecordUrl: `${token.instanceUrl}/lightning/r/${
          this.config.objectApiName}/${recordId}/view`,
        providerResponseHash: createHash("sha256").update(JSON.stringify(body))
          .digest("hex") };
    } catch { return retry("crm_provider_reconcile_unavailable"); }
  }
  private recordPath(externalKey: string) { return `/services/data/${
    this.config.apiVersion}/sobjects/${encodeURIComponent(this.config.objectApiName)}/${
    encodeURIComponent(this.config.externalIdField)}/${encodeURIComponent(externalKey)}`; }
}

function providerPayload(value: EnterpriseMarketingCrmPayload) { return {
  schemaVersion: 1, source: "wujie_ai_enterprise", tenantId: value.tenantId,
  campaignId: value.campaignId, outcomeId: value.outcomeId,
  disposition: value.disposition, intentLevel: value.intentLevel, summary: value.summary,
  evidenceHash: value.evidenceHash, sourceHash: value.sourceHash, leadId: value.leadId,
  phoneHint: value.phoneHint, ...(value.nextAction ? { nextAction: value.nextAction } : {}),
  outcomeCreatedAt: value.outcomeCreatedAt } as const; }
function auth(token: string, json = true) { return { authorization: `Bearer ${token}`,
  ...(json ? { "content-type": "application/json" } : {}) }; }
function transient(status: number) { return status === 408 || status === 409 || status === 425 ||
  status === 429 || status >= 500; }
function retry(reasonCode: string) { return { status: "retry" as const, reasonCode }; }
function failed(reasonCode: string) { return { status: "failed" as const, reasonCode }; }
function unavailable(): EnterpriseMarketingCrmProviderAdapter { return { provider: "salesforce",
  boundTenantId: null, objectApiName: null, fingerprint: null,
  async upsert() { return retry("crm_provider_not_configured"); } }; }
function validUuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value.trim()) ? value.trim() : null; }
function apiName(value: unknown) { return typeof value === "string" &&
  /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value.trim()) ? value.trim() : null; }
function secret(value: unknown) { return typeof value === "string" && value.trim().length >= 8 &&
  value.trim().length <= 4096 ? value.trim() : null; }
function salesforceUrl(value: unknown) { if (typeof value !== "string") return null;
  try { const url = new URL(value.trim()); return url.protocol === "https:" && !url.username &&
    !url.password && !url.search && !url.hash && url.pathname === "/" &&
    /(^|\.)salesforce\.com$/i.test(url.hostname) ? url.origin : null; } catch { return null; } }
