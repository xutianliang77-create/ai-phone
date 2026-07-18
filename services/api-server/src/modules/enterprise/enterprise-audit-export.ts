import { createHash, randomUUID } from "node:crypto";
import type {
  EnterpriseAuditExportDto,
  EnterpriseAuditExportPurpose,
  EnterpriseAuditExportScope,
} from "@translation/contracts";

export interface EnterpriseAuditExportRecord {
  id: string;
  tenantId: string;
  requestedBy: string;
  purpose: EnterpriseAuditExportPurpose;
  scope: EnterpriseAuditExportScope;
  format: "jsonl";
  retentionDays: number;
  idempotencyKey: string;
  requestHash: string;
  status: "processing" | "completed" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  leaseExpiresAt?: string;
  objectKey?: string;
  eventCount?: number;
  sizeBytes?: number;
  sha256?: string;
  expiresAt?: string;
  errorCode?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnterpriseAuditExportInput {
  tenantId: string;
  requestedBy: string;
  purpose: EnterpriseAuditExportPurpose;
  scope: EnterpriseAuditExportScope;
  retentionDays: number;
  idempotencyKey: string;
  now: string;
}

export function newEnterpriseAuditExport(
  input: CreateEnterpriseAuditExportInput,
): EnterpriseAuditExportRecord {
  return {
    id: randomUUID(),
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
    purpose: input.purpose,
    scope: structuredClone(input.scope),
    format: "jsonl",
    retentionDays: input.retentionDays,
    idempotencyKey: input.idempotencyKey,
    requestHash: auditExportRequestHash(input),
    status: "processing",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function auditExportRequestHash(input: {
  purpose: EnterpriseAuditExportPurpose;
  scope: EnterpriseAuditExportScope;
  retentionDays: number;
}) {
  return createHash("sha256").update(JSON.stringify({
    purpose: input.purpose,
    scope: {
      from: input.scope.from,
      until: input.scope.until,
      action: input.scope.action ?? null,
      resourceType: input.scope.resourceType ?? null,
      result: input.scope.result ?? null,
    },
    retentionDays: input.retentionDays,
    format: "jsonl",
  })).digest("hex");
}

export function auditExportDto(
  record: EnterpriseAuditExportRecord,
  now = new Date(),
): EnterpriseAuditExportDto {
  const expired = record.status === "completed" && record.expiresAt !== undefined &&
    Date.parse(record.expiresAt) <= now.getTime();
  return {
    id: record.id,
    tenantId: record.tenantId,
    requestedBy: record.requestedBy,
    purpose: record.purpose,
    scope: structuredClone(record.scope),
    format: record.format,
    retentionDays: record.retentionDays,
    status: expired ? "expired" : record.status,
    attempts: record.attempts,
    ...(record.eventCount === undefined ? {} : { eventCount: record.eventCount }),
    ...(record.sizeBytes === undefined ? {} : { sizeBytes: record.sizeBytes }),
    ...(record.sha256 === undefined ? {} : { sha256: record.sha256 }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
