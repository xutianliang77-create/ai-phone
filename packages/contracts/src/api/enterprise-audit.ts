import type { EnterpriseAuditResult } from "./enterprise.js";

export const enterpriseAuditExportPurposes = [
  "compliance_review",
  "security_investigation",
  "customer_request",
  "regulatory_request",
] as const;

export type EnterpriseAuditExportPurpose =
  (typeof enterpriseAuditExportPurposes)[number];

export const enterpriseAuditExportStatuses = [
  "processing",
  "completed",
  "failed",
  "expired",
] as const;

export type EnterpriseAuditExportStatus =
  (typeof enterpriseAuditExportStatuses)[number];

export interface EnterpriseAuditExportScope {
  from: string;
  until: string;
  action?: string;
  resourceType?: string;
  result?: EnterpriseAuditResult;
}

export interface CreateEnterpriseAuditExportRequest {
  tenantId?: string;
  purpose: EnterpriseAuditExportPurpose;
  scope: EnterpriseAuditExportScope;
  retentionDays: number;
}

export interface EnterpriseAuditExportDto {
  id: string;
  tenantId: string;
  requestedBy: string;
  purpose: EnterpriseAuditExportPurpose;
  scope: EnterpriseAuditExportScope;
  format: "jsonl";
  retentionDays: number;
  status: EnterpriseAuditExportStatus;
  attempts: number;
  eventCount?: number;
  sizeBytes?: number;
  sha256?: string;
  expiresAt?: string;
  errorCode?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseAuditExportsResponse {
  exports: EnterpriseAuditExportDto[];
}

export interface EnterpriseAuditExportResponse {
  auditExport: EnterpriseAuditExportDto;
}

export function isEnterpriseAuditExportPurpose(
  value: unknown,
): value is EnterpriseAuditExportPurpose {
  return typeof value === "string" && enterpriseAuditExportPurposes.includes(
    value as EnterpriseAuditExportPurpose,
  );
}
