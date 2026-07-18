import type {
  EnterpriseAuditExportPurpose,
  EnterpriseAuditExportScope,
} from "@translation/contracts";
import type { EnterpriseAuditExportRecord } from "./enterprise-audit-export.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

export interface EnterpriseAuditExportRuntime {
  createAuditExport(input: {
    context: EnterpriseTenantContext;
    purpose: EnterpriseAuditExportPurpose;
    scope: EnterpriseAuditExportScope;
    retentionDays: number;
    idempotencyKey: string;
    artifactStoreReady: boolean;
    now: string;
  }): Promise<
    | { status: "created" | "replayed"; auditExport: EnterpriseAuditExportRecord }
    | { status: "idempotency_conflict" | "artifact_store_required" | "storage_required" }
  >;
  listAuditExports(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; auditExports: EnterpriseAuditExportRecord[] }
    | { status: "storage_required" }
  >;
  findAuditExport(input: {
    context: EnterpriseTenantContext;
    exportId: string;
  }): Promise<
    | { status: "ready"; auditExport: EnterpriseAuditExportRecord }
    | { status: "not_found" | "storage_required" }
  >;
}
