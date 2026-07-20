import { createHash } from "node:crypto";
import type { EnterpriseMarketingOutcomeRecord } from "./enterprise-marketing-outcome.js";
import { loadEnterpriseMarketingCrmPayloadKeyring,
  sealEnterpriseMarketingCrmPayload,
  type EnterpriseMarketingCrmPayloadKeyring } from
  "./enterprise-marketing-crm-payload.js";
import type { EnterpriseMarketingCrmOutboxPayload } from
  "./enterprise-marketing-crm.js";
import { loadEnterpriseSalesforceCrmConfiguration } from
  "./enterprise-salesforce-crm-provider.js";

export interface EnterpriseMarketingCrmCommandService {
  prepare(input: { tenantId: string; syncId: string;
    outcome: EnterpriseMarketingOutcomeRecord }):
    | { status: "ready"; provider: "salesforce"; externalRecordKey: string;
        objectApiName: string; providerFingerprint: string; payloadHash: string;
        outboxPayload: EnterpriseMarketingCrmOutboxPayload }
    | { status: "not_configured"; reasonCode: string };
}

export function createEnvironmentEnterpriseMarketingCrmCommandService(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseMarketingCrmCommandService {
  const config = loadEnterpriseSalesforceCrmConfiguration(env);
  let keyring: EnterpriseMarketingCrmPayloadKeyring | null = null;
  try { keyring = loadEnterpriseMarketingCrmPayloadKeyring(env); } catch { keyring = null; }
  return { prepare(input) {
    if (!config) return unavailable("crm_provider_not_configured");
    if (config.boundTenantId !== input.tenantId) return unavailable(
      "crm_provider_tenant_not_configured");
    if (!keyring) return unavailable("crm_payload_encryption_not_configured");
    const externalRecordKey = `wujie_${createHash("sha256").update(input.tenantId)
      .update(":").update(input.outcome.id).digest("hex").slice(0, 48)}`;
    const sealed = sealEnterpriseMarketingCrmPayload({ v: 1,
      tenantId: input.tenantId, syncId: input.syncId,
      campaignId: input.outcome.campaignId, outcomeId: input.outcome.id,
      externalRecordKey, disposition: input.outcome.disposition,
      intentLevel: input.outcome.intentLevel, summary: input.outcome.summary,
      evidenceHash: input.outcome.evidenceHash, sourceHash: input.outcome.sourceHash,
      leadId: input.outcome.leadId, phoneHint: input.outcome.phoneHint,
      ...(input.outcome.nextAction ? { nextAction: {
        kind: input.outcome.nextAction.kind,
        ...(input.outcome.nextAction.dueAt
          ? { dueAt: input.outcome.nextAction.dueAt } : {}) } } : {}),
      outcomeCreatedAt: input.outcome.createdAt }, keyring);
    return { status: "ready", provider: "salesforce", externalRecordKey,
      objectApiName: config.objectApiName, providerFingerprint: config.fingerprint,
      payloadHash: sealed.payloadHash, outboxPayload: { v: 1,
        tenantId: input.tenantId, syncId: input.syncId,
        campaignId: input.outcome.campaignId, outcomeId: input.outcome.id,
        provider: "salesforce", externalRecordKey, objectApiName: config.objectApiName,
        providerFingerprint: config.fingerprint, payloadHash: sealed.payloadHash,
        sealedPayload: sealed.sealedPayload } };
  } };
}
function unavailable(reasonCode: string) { return { status: "not_configured" as const,
  reasonCode }; }
