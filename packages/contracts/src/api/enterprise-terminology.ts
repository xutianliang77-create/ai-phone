export const enterpriseContentVersionStatuses = [
  "draft", "review", "published", "expired", "failed",
] as const;

export type EnterpriseContentVersionStatus =
  (typeof enterpriseContentVersionStatuses)[number];

export const enterpriseTerminologyPurposes = [
  "all", "marketing", "support", "meeting",
] as const;

export type EnterpriseTerminologyPurpose =
  (typeof enterpriseTerminologyPurposes)[number];

export interface EnterpriseTermEntryDto {
  termId: string;
  sourceText: string;
  translatedText: string;
  aliases: string[];
  pronunciation?: string;
  caseSensitive: boolean;
  protected: boolean;
}

export interface EnterpriseTermPackDto {
  id: string;
  tenantId: string;
  name: string;
  status: "active" | "archived";
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseTermPackVersionDto {
  id: string;
  tenantId: string;
  termPackId: string;
  revision: number;
  status: EnterpriseContentVersionStatus;
  sourceLocale: string;
  targetLocale: string;
  countryCode: string;
  productCode: string;
  usageScope: EnterpriseTerminologyPurpose;
  contentHash?: string;
  termCount: number;
  effectiveFrom?: string;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  version: number;
}

export interface EnterpriseScriptTemplateDto {
  id: string;
  tenantId: string;
  name: string;
  purpose: EnterpriseTerminologyPurpose;
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseScriptTemplateVersionDto {
  id: string;
  tenantId: string;
  scriptTemplateId: string;
  revision: number;
  status: EnterpriseContentVersionStatus;
  locale: string;
  countryCode: string;
  productCode: string;
  contentHash?: string;
  requiredPhraseCount: number;
  prohibitedPhraseCount: number;
  variableCount: number;
  effectiveFrom?: string;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  version: number;
}

export interface EnterpriseRuntimeTerminologyContextDto {
  contextHash: string;
  termPackVersionId: string;
  scriptTemplateVersionId?: string;
  asr: { termPackVersionId: string };
  translation: { termPackVersionId: string };
  llm: {
    termPackVersionId: string;
    scriptTemplateVersionId?: string;
  };
  terms: EnterpriseTermEntryDto[];
  script?: {
    promptText: string;
    requiredPhrases: string[];
    prohibitedPhrases: string[];
    variables: string[];
  };
}
