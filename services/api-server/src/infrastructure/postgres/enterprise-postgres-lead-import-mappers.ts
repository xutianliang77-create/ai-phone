import type {
  EnterpriseCampaignLeadDto,
  EnterpriseLeadImportBatchDto,
} from "@translation/contracts";
import type { protectEnterpriseLeadImportRow } from
  "../../modules/enterprise/enterprise-lead-phone.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";

export type ProtectedRow = ReturnType<typeof protectEnterpriseLeadImportRow>;
export interface LeadRow extends Record<string, unknown> {
  id: string; tenant_id: string; external_id: string | null;
  phone_hash: string; phone_hint: string; country_code: string;
  timezone: string | null; language: string | null; attributes: Record<string, unknown>;
  status: "active" | "inactive"; created_by_batch_id: string | null;
  created_at: string | Date; updated_at: string | Date; version: string | number;
}
export interface CampaignLeadRow extends Record<string, unknown> {
  id: string; campaign_id: string; lead_id: string; import_batch_id: string;
  status: "active" | "rolled_back"; created_at: string | Date; version: string | number;
}
export interface LeadImportBatchRow extends Record<string, unknown> {
  id: string; campaign_id: string; source_kind: "api" | "csv";
  source_reference: string; status: "processing" | "committed" | "rolled_back";
  total_rows: number; created_count: number; linked_count: number; duplicate_count: number;
  created_by: string; idempotency_key: string; request_hash: string;
  rollback_by: string | null; rollback_key: string | null;
  rollback_request_hash: string | null; created_at: string | Date;
  committed_at: string | Date | null; rolled_back_at: string | Date | null;
  updated_at: string | Date; version: string | number;
}
export interface LeadImportReportRow extends Record<string, unknown> {
  row_number: string | number; result: "created" | "linked" | "duplicate";
  lead_id: string; phone_hint: string;
}
export interface CampaignLeadListRow extends LeadRow {
  link_id: string; import_batch_id: string; linked_at: string | Date;
}

export function mapBatch(row: LeadImportBatchRow): EnterpriseLeadImportBatchDto {
  if (row.status === "processing" || !row.committed_at) {
    throw new Error("Uncommitted lead import batch cannot be exposed");
  }
  return { id: uuid(row.id), campaignId: uuid(row.campaign_id),
    sourceKind: row.source_kind, sourceReference: bounded(row.source_reference, 200),
    status: row.status, totalRows: Number(row.total_rows),
    createdCount: Number(row.created_count), linkedCount: Number(row.linked_count),
    duplicateCount: Number(row.duplicate_count),
    createdBy: enterprisePostgresAccountSubjectId(row.created_by),
    createdAt: timestamp(row.created_at), committedAt: timestamp(row.committed_at),
    ...(row.rolled_back_at ? { rolledBackAt: timestamp(row.rolled_back_at) } : {}),
    version: Number(row.version) };
}
export function mapLead(row: CampaignLeadListRow): EnterpriseCampaignLeadDto {
  if (!row.phone_hint || !/^\+[0-9*]{5,20}$/.test(row.phone_hint) ||
    !/^[A-Z]{2}$/.test(row.country_code) ||
    !row.attributes || typeof row.attributes !== "object" || Array.isArray(row.attributes)) {
    throw new Error("Invalid campaign lead row");
  }
  return { id: uuid(row.id), linkId: uuid(row.link_id),
    ...(row.external_id ? { externalId: bounded(row.external_id, 200) } : {}),
    phoneHint: row.phone_hint, countryCode: row.country_code,
    ...(row.timezone ? { timezone: row.timezone } : {}),
    ...(row.language ? { language: row.language } : {}),
    attributeKeys: Object.keys(row.attributes).sort(), status: row.status,
    importBatchId: uuid(row.import_batch_id), linkedAt: timestamp(row.linked_at),
    version: Number(row.version) };
}
export function issue(rowNumber: number, field: string, code: string) {
  return { rowNumber, field, code };
}
export function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
  throw new Error("Invalid lead import UUID"); return value; }
export function bounded(value: unknown, max: number) { if (typeof value !== "string" ||
  value !== value.trim() || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > max)
  throw new Error("Invalid lead import text"); return value; }
export function eventKey(value: unknown) { if (typeof value !== "string" ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value))
  throw new Error("Invalid lead import idempotency key"); return value; }
export function hash(value: unknown) { if (typeof value !== "string" ||
  !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid lead import request hash");
  return value; }
export function iso(value: unknown) { const text = value instanceof Date ?
  value.toISOString() : value; if (typeof text !== "string" ||
  new Date(text).toISOString() !== text) throw new Error("Invalid lead import timestamp");
  return text; }
export function timestamp(value: unknown) { return iso(value); }
export function nextIso(value: unknown, after: string) { const candidate = iso(value);
  return candidate > after ? candidate : new Date(Date.parse(after) + 1).toISOString(); }
