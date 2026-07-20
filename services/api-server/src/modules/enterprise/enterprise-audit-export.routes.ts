import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  isEnterpriseAuditExportPurpose,
  isEnterpriseAuditResult,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import { auditExportDto } from "./enterprise-audit-export.js";
import type { EnterpriseAuditExportArtifactStore } from
  "./enterprise-audit-export-artifact-store.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

const maximumScopeMs = 31 * 86_400_000;

export async function registerEnterpriseAuditExportRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  artifactStore: EnterpriseAuditExportArtifactStore,
) {
  app.get("/enterprise/v1/audit-exports", async (request, reply) => {
    const access = await authorized(request, reply, runtime, routeService, "audit:read", false);
    if (!access) return;
    const result = await runtime.listAuditExports({
      context: contextFor(access, request),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    const now = new Date();
    return reply.send({
      exports: result.auditExports.map((record) => auditExportDto(record, now)),
    });
  });

  app.post("/enterprise/v1/audit-exports", async (request, reply) => {
    const access = await authorized(
      request, reply, runtime, routeService, "audit:export", true,
    );
    if (!access) return;
    if (access.tenant.status !== "active") {
      return sendError(
        reply, 409, "tenant_lifecycle_pending",
        "Audit export rejected during tenant lifecycle",
      );
    }
    const idempotencyKey = idempotencyHeader(request);
    if (!idempotencyKey) {
      return sendError(reply, 400, "idempotency_key_required", "Idempotency key required");
    }
    const now = new Date();
    const parsed = parseRequest(request.body, now);
    if (!parsed) {
      return sendError(reply, 400, "invalid_audit_export", "Invalid audit export");
    }
    if (parsed.tenantId !== undefined && parsed.tenantId !== access.tenant.id) {
      return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
    }
    const result = await runtime.createAuditExport({
      context: contextFor(access, request),
      purpose: parsed.purpose,
      scope: parsed.scope,
      retentionDays: parsed.retentionDays,
      idempotencyKey,
      artifactStoreReady: artifactStore.ready,
      now: now.toISOString(),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    if (result.status === "artifact_store_required") {
      return sendError(
        reply, 503, artifactStore.reasonCode ?? "audit_export_store_not_configured",
        "Audit export artifact store is not configured",
      );
    }
    if (result.status === "idempotency_conflict") {
      return sendError(reply, 409, result.status, "Idempotency conflict");
    }
    if (!("auditExport" in result)) {
      return sendError(reply, 500, "audit_export_state_invalid", "Invalid audit export state");
    }
    return reply.status(result.status === "created" ? 201 : 200).send({
      auditExport: auditExportDto(result.auditExport, now),
    });
  });

  app.get<{ Params: { exportId: string } }>(
    "/enterprise/v1/audit-exports/:exportId/download",
    async (request, reply) => {
      const access = await authorized(
        request, reply, runtime, routeService, "audit:export", true,
      );
      if (!access) return;
      if (!uuid(request.params.exportId)) {
        return sendError(reply, 400, "invalid_audit_export_id", "Invalid audit export ID");
      }
      const context = contextFor(access, request);
      const found = await runtime.findAuditExport({
        context,
        exportId: request.params.exportId,
      });
      if (found.status === "storage_required") return postgresRequired(reply);
      if (found.status === "not_found") {
        return sendError(reply, 404, "audit_export_not_found", "Audit export not found");
      }
      if (!("auditExport" in found)) {
        return sendError(reply, 500, "audit_export_state_invalid", "Invalid audit export state");
      }
      const record = found.auditExport;
      if (record.status !== "completed" || !record.objectKey || !record.sha256 ||
        record.sizeBytes === undefined || !record.expiresAt) {
        return sendError(reply, 409, "audit_export_not_completed", "Audit export not completed");
      }
      if (Date.parse(record.expiresAt) <= Date.now()) {
        await downloadAudit(runtime, context, record.id, "denied", "audit_export_expired");
        return sendError(reply, 410, "audit_export_expired", "Audit export expired");
      }
      if (!artifactStore.ready) {
        return sendError(
          reply, 503, artifactStore.reasonCode ?? "audit_export_store_not_configured",
          "Audit export artifact store is not configured",
        );
      }
      const artifact = await artifactStore.get(record.objectKey);
      if (artifact.status !== "ready") {
        await downloadAudit(runtime, context, record.id, "failed", artifact.reasonCode);
        return sendError(
          reply, artifact.status === "not_found" ? 404 : 503,
          artifact.reasonCode,
          "Audit export artifact unavailable",
        );
      }
      if (artifact.sha256 !== record.sha256 || artifact.sizeBytes !== record.sizeBytes ||
        sha256(artifact.body) !== record.sha256) {
        await downloadAudit(
          runtime, context, record.id, "failed", "audit_export_integrity_mismatch",
        );
        return sendError(
          reply, 503, "audit_export_integrity_mismatch",
          "Audit export artifact integrity check failed",
        );
      }
      await downloadAudit(runtime, context, record.id, "completed", "verified");
      return reply
        .header("cache-control", "no-store")
        .header("content-type", "application/x-ndjson")
        .header("content-length", String(artifact.sizeBytes))
        .header("x-content-sha256", artifact.sha256)
        .header(
          "content-disposition",
          `attachment; filename="audit-export-${record.id}.jsonl"`,
        )
        .send(artifact.body);
    },
  );
}

async function authorized(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "audit:read" | "audit:export",
  requireRoute: boolean,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action: scope === "audit:export" ? "audit_export.access" : "audit_export.list",
    resourceType: "audit_export",
  });
  if (!access || (requireRoute && !requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  ))) return null;
  return access;
}

function contextFor(
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
  request: FastifyRequest,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id,
    actorUserId: access.account.id,
    actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request),
  });
}

function parseRequest(value: unknown, now: Date) {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const scope = body.scope && typeof body.scope === "object"
    ? body.scope as Record<string, unknown>
    : null;
  const from = timestamp(scope?.from);
  const until = timestamp(scope?.until);
  if (!isEnterpriseAuditExportPurpose(body.purpose) || !scope || !from || !until ||
    Date.parse(until) <= Date.parse(from) || Date.parse(until) - Date.parse(from) > maximumScopeMs ||
    Date.parse(until) > now.getTime() + 60_000 || !integer(body.retentionDays, 1, 30) ||
    !optionalIdentifier(scope.action) || !optionalIdentifier(scope.resourceType) ||
    !optionalResult(scope.result) ||
    (body.tenantId !== undefined && typeof body.tenantId !== "string")) return null;
  return {
    tenantId: body.tenantId as string | undefined,
    purpose: body.purpose,
    retentionDays: body.retentionDays as number,
    scope: {
      from,
      until,
      ...(scope.action === undefined ? {} : { action: scope.action as string }),
      ...(scope.resourceType === undefined
        ? {} : { resourceType: scope.resourceType as string }),
      ...(scope.result === undefined ? {} : { result: scope.result }),
    },
  };
}

function idempotencyHeader(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
    ? value : null;
}
function optionalIdentifier(value: unknown) {
  return value === undefined ||
    (typeof value === "string" && /^[a-z][a-z0-9._:-]{0,79}$/.test(value));
}
function optionalResult(value: unknown) {
  return value === undefined || isEnterpriseAuditResult(value);
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null;
}
function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function uuid(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required", "PostgreSQL required");
}
function downloadAudit(
  runtime: EnterpriseRepositoryRuntime,
  context: ReturnType<typeof contextFor>,
  exportId: string,
  result: "completed" | "failed" | "denied",
  reasonCode: string,
) {
  return runtime.appendAudit({
    context,
    action: "audit_export.download",
    resourceType: "audit_export",
    resourceId: exportId,
    result,
    details: { reasonCode },
  });
}
