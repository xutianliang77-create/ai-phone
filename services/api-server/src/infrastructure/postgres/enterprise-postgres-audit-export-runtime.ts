import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import {
  newEnterpriseAuditExport,
} from "../../modules/enterprise/enterprise-audit-export.js";
import type { EnterpriseAuditExportRuntime } from
  "../../modules/enterprise/enterprise-audit-export-runtime.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresAuditExportRuntime(
  pool: EnterprisePostgresPool,
): EnterpriseAuditExportRuntime {
  return {
    createAuditExport(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.auditExports.create({
          artifactStoreReady: input.artifactStoreReady,
          record: newEnterpriseAuditExport({
            tenantId: input.context.tenantId,
            requestedBy: input.context.actorUserId,
            purpose: input.purpose,
            scope: input.scope,
            retentionDays: input.retentionDays,
            idempotencyKey: input.idempotencyKey,
            now: input.now,
          }),
        });
        if (result.status !== "created") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context,
          action: "audit_export.request",
          resourceType: "audit_export",
          resourceId: result.auditExport.id,
          result: "accepted",
          details: {
            purpose: input.purpose,
            scopeFrom: input.scope.from,
            scopeUntil: input.scope.until,
            retentionDays: input.retentionDays,
            format: "jsonl",
          },
          createdAt: input.now,
        }));
        return result;
      });
    },
    async listAuditExports(input) {
      const auditExports = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.auditExports.list(),
      );
      return { status: "ready", auditExports };
    },
    async findAuditExport(input) {
      const auditExport = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.auditExports.find(input.exportId),
      );
      return auditExport
        ? { status: "ready", auditExport }
        : { status: "not_found" };
    },
  };
}
