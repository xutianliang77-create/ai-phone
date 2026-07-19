import type {
  EnterpriseMarketingConsentCollectionChannel,
  EnterpriseMarketingConsentEvidenceInput,
} from "@translation/contracts";
import type { EnterpriseMarketingConsentRecord } from
  "./enterprise-marketing-consent.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingConsentRepositoryRuntime {
  registerMarketingConsent?(input: {
    context: EnterpriseTenantContext;
    consent: {
      id: string; campaignId: string; leadId: string;
      collectionChannel: EnterpriseMarketingConsentCollectionChannel;
      evidence: EnterpriseMarketingConsentEvidenceInput;
      sourceReference: string; grantedAt: string; expiresAt?: string;
      consentStatementVersion: string; idempotencyKey: string;
      requestHash: string; createdAt: string;
    };
  }): Promise<
    | { status: "created" | "replayed"; consent: EnterpriseMarketingConsentRecord }
    | { status: "not_found" | "campaign_not_editable" | "idempotency_conflict" |
        "evidence_conflict" }
    | StorageRequired
  >;
  listMarketingConsents?(input: {
    context: EnterpriseTenantContext; campaignId: string; leadId: string;
    evaluatedAt: string;
  }): Promise<
    | { status: "ready"; consents: EnterpriseMarketingConsentRecord[] }
    | { status: "not_found" } | StorageRequired
  >;
  resolveMarketingConsentEligibility?(input: {
    context: EnterpriseTenantContext; campaignId: string; leadId: string;
    evaluatedAt: string;
  }): Promise<
    | { status: "eligible"; consent: EnterpriseMarketingConsentRecord }
    | { status: "blocked"; latest?: EnterpriseMarketingConsentRecord }
    | { status: "not_found" } | StorageRequired
  >;
  revokeMarketingConsent?(input: {
    context: EnterpriseTenantContext; campaignId: string; leadId: string;
    consentId: string; expectedVersion: number; reason: string;
    idempotencyKey: string; requestHash: string; occurredAt: string;
  }): Promise<
    | { status: "revoked" | "replayed"; consent: EnterpriseMarketingConsentRecord;
        cancelledTaskCount: number }
    | { status: "not_found" | "conflict" | "idempotency_conflict" }
    | StorageRequired
  >;
}
