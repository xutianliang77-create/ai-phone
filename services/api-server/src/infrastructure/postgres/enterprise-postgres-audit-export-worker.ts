import type {
  EnterpriseAuditExportArtifactStore,
} from "../../modules/enterprise/enterprise-audit-export-artifact-store.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseAuditExportRecord } from
  "../../modules/enterprise/enterprise-audit-export.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import type { EnterpriseAuditExportFinalization } from
  "./enterprise-postgres-audit-export.repository.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

const maximumEvents = 10_000;
const maximumAttempts = 5;

export async function processEnterpriseAuditExport(input: {
  pool: EnterprisePostgresPool;
  store: EnterpriseAuditExportArtifactStore;
  auditExport: EnterpriseAuditExportRecord;
  now: Date;
  traceId: string;
  beforeFinalize?: () => Promise<void>;
}) {
  const events = await withEnterprisePostgresUnitOfWork(
    input.pool,
    createEnterpriseTenantContext({
      tenantId: input.auditExport.tenantId,
      actorUserId: "system:enterprise-audit-export",
      traceId: input.traceId,
    }),
    (unit) => unit.auditExports.events(input.auditExport, maximumEvents + 1),
  );
  if (events.length > maximumEvents) {
    return finalize(input, {
      status: "failed",
      errorCode: "audit_export_scope_too_large",
    });
  }
  const content = serializeArtifact(input.auditExport, events, input.now);
  const expiresAt = new Date(
    input.now.getTime() + input.auditExport.retentionDays * 86_400_000,
  ).toISOString();
  let stored;
  try {
    stored = await input.store.put({
      tenantId: input.auditExport.tenantId,
      exportId: input.auditExport.id,
      content,
      expiresAt,
    });
  } catch {
    stored = { status: "retry" as const, reasonCode: "audit_export_store_unavailable" };
  }
  if (stored.status === "stored") {
    return finalize(input, {
      status: "completed",
      objectKey: stored.objectKey,
      eventCount: events.length,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      expiresAt,
    });
  }
  const errorCode = safeErrorCode(stored.reasonCode);
  return input.auditExport.attempts >= maximumAttempts || stored.status === "failed"
    ? finalize(input, { status: "failed", errorCode })
    : finalize(input, {
        status: "retry",
        errorCode,
        nextAttemptAt: new Date(
          input.now.getTime() + retryDelay(input.auditExport.attempts),
        ).toISOString(),
      });
}

async function finalize(
  input: Parameters<typeof processEnterpriseAuditExport>[0],
  result: EnterpriseAuditExportFinalization,
) {
  await input.beforeFinalize?.();
  const context = createEnterpriseTenantContext({
    tenantId: input.auditExport.tenantId,
    actorUserId: "system:enterprise-audit-export",
    traceId: input.traceId,
  });
  return withEnterprisePostgresUnitOfWork(
    input.pool,
    context,
    async (unit) => {
      const finalized = await unit.auditExports.finalize({
        id: input.auditExport.id,
        attempt: input.auditExport.attempts,
        now: input.now.toISOString(),
        result,
      });
      if (finalized.status !== "updated") {
        throw new Error("Enterprise audit export finalize conflict");
      }
      if (result.status !== "retry") {
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context,
          action: result.status === "completed"
            ? "audit_export.complete"
            : "audit_export.fail",
          resourceType: "audit_export",
          resourceId: input.auditExport.id,
          result: result.status === "completed" ? "completed" : "failed",
          details: result.status === "completed" ? {
            eventCount: result.eventCount,
            sizeBytes: result.sizeBytes,
            artifactHash: result.sha256,
            expiresAt: result.expiresAt,
          } : { errorCode: result.errorCode },
          createdAt: input.now.toISOString(),
        }));
      }
      return finalized.auditExport;
    },
  );
}

function serializeArtifact(
  auditExport: EnterpriseAuditExportRecord,
  events: import("../../modules/enterprise/enterprise-tenant-record.js")
    .EnterpriseAuditEventRecord[],
  generatedAt: Date,
) {
  const lines = [JSON.stringify({
    recordType: "manifest",
    schemaVersion: 1,
    exportId: auditExport.id,
    tenantId: auditExport.tenantId,
    purpose: auditExport.purpose,
    scope: auditExport.scope,
    format: auditExport.format,
    eventCount: events.length,
    generatedAt: generatedAt.toISOString(),
  })];
  for (const event of events) lines.push(JSON.stringify({
    recordType: "audit_event",
    id: event.id,
    tenantId: event.tenantId,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    result: event.result,
    details: event.details,
    traceId: event.traceId,
    createdAt: event.createdAt,
  }));
  return `${lines.join("\n")}\n`;
}

function retryDelay(attempt: number) {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 300_000);
}
function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value)
    ? value
    : "audit_export_failed";
}
