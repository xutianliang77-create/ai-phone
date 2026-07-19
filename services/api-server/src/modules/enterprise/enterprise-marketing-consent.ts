import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingConsentCollectionChannel,
  EnterpriseMarketingConsentDto,
  EnterpriseMarketingConsentEligibilityReason,
  EnterpriseMarketingConsentEvidenceInput,
} from "@translation/contracts";

export const enterpriseMarketingConsentPurpose = "automated_marketing_call" as const;

export interface EnterpriseMarketingConsentRecord {
  id: string;
  tenantId: string;
  campaignId: string;
  leadId: string;
  purpose: typeof enterpriseMarketingConsentPurpose;
  collectionChannel: EnterpriseMarketingConsentCollectionChannel;
  evidence: EnterpriseMarketingConsentEvidenceInput;
  sourceReference: string;
  grantedAt: string;
  expiresAt?: string;
  consentStatementVersion: string;
  revokedAt?: string;
  revocationReason?: string;
  createdBy: string;
  createdAt: string;
  version: number;
}

export function marketingConsentStatus(
  consent: EnterpriseMarketingConsentRecord,
  evaluatedAt: string,
): EnterpriseMarketingConsentDto["status"] {
  if (consent.revokedAt && consent.revokedAt <= evaluatedAt) return "revoked";
  if (consent.expiresAt && consent.expiresAt <= evaluatedAt) return "expired";
  if (consent.grantedAt > evaluatedAt) return "pending";
  return "active";
}

export function marketingConsentBlockedReason(
  consent: EnterpriseMarketingConsentRecord | undefined,
  evaluatedAt: string,
): EnterpriseMarketingConsentEligibilityReason {
  if (!consent) return "consent_required";
  if (consent.revokedAt && consent.revokedAt <= evaluatedAt) return "consent_revoked";
  if (consent.expiresAt && consent.expiresAt <= evaluatedAt) return "consent_expired";
  return consent.grantedAt > evaluatedAt
    ? "consent_not_yet_valid" : "consent_required";
}

export function marketingConsentDto(
  record: EnterpriseMarketingConsentRecord,
  evaluatedAt: string,
): EnterpriseMarketingConsentDto {
  const { tenantId: _tenantId, ...value } = record;
  return { ...value, status: marketingConsentStatus(record, evaluatedAt) };
}

export function marketingConsentRegistrationHash(input: {
  actorUserId: string;
  campaignId: string;
  leadId: string;
  collectionChannel: EnterpriseMarketingConsentCollectionChannel;
  evidence: EnterpriseMarketingConsentEvidenceInput;
  sourceReference: string;
  grantedAt: string;
  expiresAt?: string;
  consentStatementVersion: string;
}) {
  return digest({ ...input, purpose: enterpriseMarketingConsentPurpose });
}

export function marketingConsentRevocationHash(input: {
  actorUserId: string;
  campaignId: string;
  leadId: string;
  consentId: string;
  expectedVersion: number;
  reason: string;
}) {
  return digest(input);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
