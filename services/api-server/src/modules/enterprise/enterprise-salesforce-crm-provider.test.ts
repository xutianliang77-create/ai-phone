import { describe, expect, it, vi } from "vitest";
import { createEnvironmentEnterpriseSalesforceCrmProvider } from
  "./enterprise-salesforce-crm-provider.js";
import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const payload: EnterpriseMarketingCrmPayload = { v: 1, tenantId,
  syncId: "00000000-0000-4000-8000-000000000002",
  campaignId: "00000000-0000-4000-8000-000000000003",
  outcomeId: "00000000-0000-4000-8000-000000000004",
  leadId: "00000000-0000-4000-8000-000000000005",
  externalRecordKey: `wujie_${"a".repeat(48)}`, disposition: "potential_lead",
  intentLevel: "high", summary: "客户希望跟进。", evidenceHash: "b".repeat(64),
  sourceHash: "c".repeat(64), phoneHint: "138****0000",
  outcomeCreatedAt: "2026-07-20T00:00:00.000Z" };

describe("enterprise Salesforce CRM provider", () => {
  it("fails closed when OAuth or tenant/object mapping is incomplete", async () => {
    const provider = createEnvironmentEnterpriseSalesforceCrmProvider({ env: {} });
    expect(provider.boundTenantId).toBeNull();
    await expect(provider.upsert(payload)).resolves.toEqual({ status: "retry",
      reasonCode: "crm_provider_not_configured" });
  });
  it("uses external-ID PATCH and verifies the persisted record before success", async () => {
    const providerBody = JSON.stringify({ schemaVersion: 1,
      source: "wujie_ai_enterprise", tenantId, campaignId: payload.campaignId,
      outcomeId: payload.outcomeId, disposition: payload.disposition,
      intentLevel: payload.intentLevel, summary: payload.summary,
      evidenceHash: payload.evidenceHash, sourceHash: payload.sourceHash,
      leadId: payload.leadId, phoneHint: payload.phoneHint,
      outcomeCreatedAt: payload.outcomeCreatedAt });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "t".repeat(32),
        instance_url: "https://example.my.salesforce.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Id: "a00123456789012345",
        Wujie_Outcome_Key__c: payload.externalRecordKey,
        Wujie_Payload__c: providerBody }), { status: 200 }));
    const provider = createEnvironmentEnterpriseSalesforceCrmProvider({
      env: configured(), fetch: fetcher });
    await expect(provider.upsert(payload)).resolves.toMatchObject({ status: "completed",
      providerRecordId: "a00123456789012345" });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `https://example.my.salesforce.com/services/data/v65.0/sobjects/` +
      `Wujie_Marketing_Outcome__c/Wujie_Outcome_Key__c/${payload.externalRecordKey}`);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetcher.mock.calls[2]?.[0]).toContain("?fields=");
  });
  it("returns retry for a rate-limited provider without claiming success", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "t".repeat(32),
        instance_url: "https://example.my.salesforce.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    const provider = createEnvironmentEnterpriseSalesforceCrmProvider({
      env: configured(), fetch: fetcher });
    await expect(provider.upsert(payload)).resolves.toEqual({ status: "retry",
      reasonCode: "crm_provider_temporarily_unavailable" });
  });
});

function configured(): NodeJS.ProcessEnv { return {
  ENTERPRISE_CRM_PROVIDER: "salesforce", ENTERPRISE_SALESFORCE_TENANT_ID: tenantId,
  ENTERPRISE_SALESFORCE_LOGIN_URL: "https://example.my.salesforce.com",
  ENTERPRISE_SALESFORCE_CLIENT_ID: "client-id", ENTERPRISE_SALESFORCE_CLIENT_SECRET:
    "client-secret", ENTERPRISE_SALESFORCE_API_VERSION: "v65.0",
  ENTERPRISE_SALESFORCE_OBJECT_API_NAME: "Wujie_Marketing_Outcome__c",
  ENTERPRISE_SALESFORCE_EXTERNAL_ID_FIELD: "Wujie_Outcome_Key__c",
  ENTERPRISE_SALESFORCE_PAYLOAD_FIELD: "Wujie_Payload__c" }; }
