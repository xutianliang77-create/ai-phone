export type EnterpriseLeadImportSourceKind = "api" | "csv";
export type EnterpriseLeadImportBatchStatus = "committed" | "rolled_back";
export type EnterpriseLeadImportRowResult = "created" | "linked" | "duplicate";

export type EnterpriseLeadAttributeValue = string | number | boolean | null;

export interface EnterpriseLeadImportRowInput {
  externalId?: string;
  phone: string;
  countryCode: string;
  timezone?: string;
  language?: string;
  attributes?: Record<string, EnterpriseLeadAttributeValue>;
}

interface EnterpriseLeadImportRequestBase {
  tenantId?: string;
  sourceReference: string;
}

export type EnterpriseLeadImportRequest = EnterpriseLeadImportRequestBase & (
  | { sourceKind: "api"; rows: EnterpriseLeadImportRowInput[]; csv?: never }
  | { sourceKind: "csv"; csv: string; rows?: never }
);

export interface EnterpriseLeadImportBatchDto {
  id: string;
  campaignId: string;
  sourceKind: EnterpriseLeadImportSourceKind;
  sourceReference: string;
  status: EnterpriseLeadImportBatchStatus;
  totalRows: number;
  createdCount: number;
  linkedCount: number;
  duplicateCount: number;
  createdBy: string;
  createdAt: string;
  committedAt: string;
  rolledBackAt?: string;
  version: number;
}

export interface EnterpriseLeadImportRowReportDto {
  rowNumber: number;
  result: EnterpriseLeadImportRowResult;
  leadId: string;
  phoneHint: string;
}

export interface EnterpriseLeadImportErrorDto {
  rowNumber: number;
  field: string;
  code: string;
}

export type EnterpriseLeadImportResponse =
  | { status: "committed" | "replayed"; batch: EnterpriseLeadImportBatchDto;
      rows: EnterpriseLeadImportRowReportDto[] }
  | { status: "rejected"; totalRows: number;
      errors: EnterpriseLeadImportErrorDto[] };

export interface EnterpriseCampaignLeadDto {
  id: string;
  linkId: string;
  externalId?: string;
  phoneHint: string;
  countryCode: string;
  timezone?: string;
  language?: string;
  attributeKeys: string[];
  status: "active" | "inactive";
  importBatchId: string;
  linkedAt: string;
  version: number;
}

export interface EnterpriseCampaignLeadsResponse {
  leads: EnterpriseCampaignLeadDto[];
}

export interface EnterpriseLeadImportBatchesResponse {
  batches: EnterpriseLeadImportBatchDto[];
}

export interface RollbackEnterpriseLeadImportRequest {
  tenantId?: string;
  expectedVersion: number;
}

export interface EnterpriseLeadImportRollbackResponse {
  status: "rolled_back" | "replayed";
  batch: EnterpriseLeadImportBatchDto;
}
