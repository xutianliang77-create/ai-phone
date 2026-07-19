export type EnterpriseMarketingConsentPurpose = "automated_marketing_call";

export type EnterpriseMarketingConsentCollectionChannel =
  | "web_form"
  | "signed_document"
  | "recorded_call"
  | "crm_attestation";

export type EnterpriseMarketingConsentStatus =
  | "pending"
  | "active"
  | "expired"
  | "revoked";

export interface EnterpriseMarketingConsentEvidenceInput {
  objectId: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
}

export interface RegisterEnterpriseMarketingConsentRequest {
  tenantId?: string;
  purpose: EnterpriseMarketingConsentPurpose;
  collectionChannel: EnterpriseMarketingConsentCollectionChannel;
  evidence: EnterpriseMarketingConsentEvidenceInput;
  sourceReference: string;
  grantedAt: string;
  expiresAt?: string;
  consentStatementVersion: string;
}

export interface RevokeEnterpriseMarketingConsentRequest {
  tenantId?: string;
  expectedVersion: number;
  reason: string;
}

export interface EnterpriseMarketingConsentDto {
  id: string;
  campaignId: string;
  leadId: string;
  purpose: EnterpriseMarketingConsentPurpose;
  collectionChannel: EnterpriseMarketingConsentCollectionChannel;
  evidence: EnterpriseMarketingConsentEvidenceInput;
  sourceReference: string;
  grantedAt: string;
  expiresAt?: string;
  consentStatementVersion: string;
  status: EnterpriseMarketingConsentStatus;
  revokedAt?: string;
  revocationReason?: string;
  createdBy: string;
  createdAt: string;
  version: number;
}

export interface EnterpriseMarketingConsentsResponse {
  evaluatedAt: string;
  consents: EnterpriseMarketingConsentDto[];
}

export type EnterpriseMarketingConsentEligibilityReason =
  | "consent_required"
  | "consent_not_yet_valid"
  | "consent_expired"
  | "consent_revoked";

export type EnterpriseMarketingConsentEligibilityResponse =
  | { status: "eligible"; evaluatedAt: string;
      consent: EnterpriseMarketingConsentDto }
  | { status: "blocked"; evaluatedAt: string;
      reasonCode: EnterpriseMarketingConsentEligibilityReason };

export interface EnterpriseMarketingConsentResponse {
  consent: EnterpriseMarketingConsentDto;
  replayed?: true;
}

export interface EnterpriseMarketingConsentRevocationResponse extends
  EnterpriseMarketingConsentResponse {
  cancelledTaskCount: number;
}
