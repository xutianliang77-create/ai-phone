export const enterpriseKnowledgeSourceTypes = [
  "upload",
  "url",
  "text",
  "integration",
] as const;

export type EnterpriseKnowledgeSourceType =
  (typeof enterpriseKnowledgeSourceTypes)[number];

export const enterpriseKnowledgeVersionStatuses = [
  "draft",
  "processing",
  "review",
  "published",
  "expired",
  "failed",
] as const;

export type EnterpriseKnowledgeVersionStatus =
  (typeof enterpriseKnowledgeVersionStatuses)[number];

export interface EnterpriseKnowledgeSourceDto {
  id: string;
  tenantId: string;
  name: string;
  sourceType: EnterpriseKnowledgeSourceType;
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseKnowledgeVersionDto {
  id: string;
  tenantId: string;
  sourceId: string;
  revision: number;
  status: EnterpriseKnowledgeVersionStatus;
  locale: string;
  countryCode: string;
  productCode: string;
  contentHash?: string;
  chunkCount: number;
  effectiveFrom?: string;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  version: number;
}

export interface EnterpriseKnowledgeSearchResultDto {
  knowledgeVersionId: string;
  sourceId: string;
  revision: number;
  blockId: string;
  content: string;
  contentHash: string;
  citation: string;
}
