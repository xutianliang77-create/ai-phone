import { describe, expect, it } from "vitest";
import { createMockEnterpriseMarketingCrmProvider } from
  "./enterprise-marketing-crm-mock-provider.js";
import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const payload: EnterpriseMarketingCrmPayload = { v: 1, tenantId,
  syncId: "00000000-0000-4000-8000-000000000002",
  campaignId: "00000000-0000-4000-8000-000000000003",
  outcomeId: "00000000-0000-4000-8000-000000000004",
  leadId: "00000000-0000-4000-8000-000000000005",
  externalRecordKey: `wujie_${"a".repeat(48)}`,
  disposition: "potential_lead", intentLevel: "high", summary: "客户希望跟进。",
  evidenceHash: "b".repeat(64), sourceHash: "c".repeat(64), phoneHint: "138****0000",
  nextAction: { kind: "callback", dueAt: "2026-07-21T00:00:00.000Z" },
  outcomeCreatedAt: "2026-07-20T00:00:00.000Z" };

describe("enterprise marketing CRM provider contract", () => {
  it("upserts the same external record key without creating a duplicate", async () => {
    const provider = createMockEnterpriseMarketingCrmProvider({ boundTenantId: tenantId });
    const first = await provider.upsert(payload);
    const second = await provider.upsert({ ...payload, summary: "客户确认明日跟进。" });
    expect(first.status).toBe("completed"); expect(second.status).toBe("completed");
    expect(provider.uniqueRecordCount()).toBe(1);
    expect(second.providerRecordId).toBe(first.providerRecordId);
  });
  it("rejects a forged tenant before writing provider state", async () => {
    const provider = createMockEnterpriseMarketingCrmProvider({ boundTenantId: tenantId });
    const result = await provider.upsert({ ...payload,
      tenantId: "00000000-0000-4000-8000-000000000099" });
    expect(result).toEqual({ status: "failed",
      reasonCode: "crm_provider_tenant_mismatch" });
    expect(provider.uniqueRecordCount()).toBe(0);
  });
});
