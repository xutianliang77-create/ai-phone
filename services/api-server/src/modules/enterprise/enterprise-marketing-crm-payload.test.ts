import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openEnterpriseMarketingCrmPayload, sealEnterpriseMarketingCrmPayload,
  type EnterpriseMarketingCrmPayloadKeyring } from
  "./enterprise-marketing-crm-payload.js";
import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";

const payload: EnterpriseMarketingCrmPayload = { v: 1,
  tenantId: "00000000-0000-4000-8000-000000000001",
  syncId: "00000000-0000-4000-8000-000000000002",
  campaignId: "00000000-0000-4000-8000-000000000003",
  outcomeId: "00000000-0000-4000-8000-000000000004",
  leadId: "00000000-0000-4000-8000-000000000005",
  externalRecordKey: `wujie_${"a".repeat(48)}`, disposition: "potential_lead",
  intentLevel: "high", summary: "客户希望跟进。", evidenceHash: "b".repeat(64),
  sourceHash: "c".repeat(64), phoneHint: "138****0000",
  outcomeCreatedAt: "2026-07-20T00:00:00.000Z" };
const keyring: EnterpriseMarketingCrmPayloadKeyring = { activeKeyId: "primary",
  keys: new Map([["primary", randomBytes(32)]]) };

describe("enterprise marketing CRM payload", () => {
  it("round trips only with matching tenant and aggregate AAD", () => {
    const sealed = sealEnterpriseMarketingCrmPayload(payload, keyring);
    expect(openEnterpriseMarketingCrmPayload({ tenantId: payload.tenantId,
      syncId: payload.syncId, campaignId: payload.campaignId,
      outcomeId: payload.outcomeId, externalRecordKey: payload.externalRecordKey,
      ...sealed }, keyring)).toEqual(payload);
    expect(() => openEnterpriseMarketingCrmPayload({ tenantId: payload.tenantId,
      syncId: payload.syncId, campaignId: payload.campaignId,
      outcomeId: "00000000-0000-4000-8000-000000000099",
      externalRecordKey: payload.externalRecordKey, ...sealed }, keyring)).toThrow();
  });
});
