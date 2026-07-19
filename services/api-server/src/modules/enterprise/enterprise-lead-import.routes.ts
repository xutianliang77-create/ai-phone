import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  EnterpriseLeadImportRequest,
  EnterpriseLeadImportRowInput,
  RollbackEnterpriseLeadImportRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import {
  enterpriseLeadImportRequestHash,
  enterpriseLeadImportRollbackRequestHash,
  normalizeEnterpriseLeadImport,
} from "./enterprise-lead-import.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseLeadImportRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/leads",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply, "invalid_campaign_id");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.leads_list", campaignId);
      if (!access) return;
      if (!runtime.listCampaignLeads) return postgresRequired(reply);
      const result = await runtime.listCampaignLeads({
        context: context(request, access), campaignId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      return result.status === "not_found" ? notFound(reply)
        : reply.send({ leads: result.leads });
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/lead-imports",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply, "invalid_campaign_id");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.lead_imports_list", campaignId);
      if (!access) return;
      if (!runtime.listLeadImportBatches) return postgresRequired(reply);
      const result = await runtime.listLeadImportBatches({
        context: context(request, access), campaignId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      return result.status === "not_found" ? notFound(reply)
        : reply.send({ batches: result.batches });
    },
  );

  app.post<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/lead-imports",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const body = importBody(request.body);
      if (!campaignId || !body) return invalid(reply, "invalid_lead_import");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.leads_import", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      const normalized = normalizeEnterpriseLeadImport(body);
      if (normalized.status === "rejected") return reply.send(normalized);
      if (!runtime.importCampaignLeads) return postgresRequired(reply);
      const occurredAt = new Date().toISOString();
      const result = await runtime.importCampaignLeads({
        context: context(request, access), campaignId,
        sourceKind: normalized.sourceKind,
        sourceReference: normalized.sourceReference,
        rows: normalized.rows, idempotencyKey: key, occurredAt,
        requestHash: enterpriseLeadImportRequestHash({
          actorUserId: access.account.id, campaignId,
          sourceKind: normalized.sourceKind,
          sourceReference: normalized.sourceReference, rows: normalized.rows,
        }),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "protection_required") return protectionRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "campaign_not_editable") return sendError(reply, 409,
        "campaign_not_editable", "Only an unsubmitted draft accepts lead imports");
      if (result.status === "idempotency_conflict") return sendError(reply, 409,
        "idempotency_conflict", "Lead import idempotency conflict");
      if (result.status === "rejected") return reply.send(result);
      return reply.code(result.status === "committed" ? 201 : 200).send(result);
    },
  );

  app.post<{ Params: { campaignId: string; batchId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/lead-imports/:batchId/rollback",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const batchId = uuid(request.params.batchId);
      const body = rollbackBody(request.body);
      if (!campaignId || !batchId || !body) {
        return invalid(reply, "invalid_lead_import_rollback");
      }
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.leads_import_rollback", batchId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      if (!runtime.rollbackLeadImportBatch) return postgresRequired(reply);
      const result = await runtime.rollbackLeadImportBatch({
        context: context(request, access), campaignId, batchId,
        expectedVersion: body.expectedVersion, idempotencyKey: key,
        occurredAt: new Date().toISOString(),
        requestHash: enterpriseLeadImportRollbackRequestHash({
          actorUserId: access.account.id, campaignId, batchId,
          expectedVersion: body.expectedVersion,
        }),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply, "lead_import_not_found");
      if (result.status === "campaign_not_editable") return sendError(reply, 409,
        "campaign_not_editable", "Only an unsubmitted draft accepts lead rollbacks");
      if (result.status === "conflict") return sendError(reply, 409,
        "lead_import_version_conflict", "Lead import version conflict");
      if (result.status === "idempotency_conflict") return sendError(reply, 409,
        "idempotency_conflict", "Lead import rollback idempotency conflict");
      return reply.send(result);
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "campaign", resourceId });
  return access && requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  ) ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) {
  return createEnterpriseTenantContext({ tenantId: access.tenant.id,
    actorUserId: access.account.id, actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request) });
}
function importBody(value: unknown): EnterpriseLeadImportRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "sourceKind", "sourceReference", "rows", "csv"])) {
    return null;
  }
  const tenantId = optionalUuid(body.tenantId);
  if (tenantId === null || typeof body.sourceReference !== "string") return null;
  if (body.sourceKind === "api" && Array.isArray(body.rows) && body.csv === undefined) {
    return { ...(tenantId ? { tenantId } : {}), sourceKind: "api",
      sourceReference: body.sourceReference,
      rows: body.rows as EnterpriseLeadImportRowInput[] };
  }
  if (body.sourceKind === "csv" && typeof body.csv === "string" &&
    body.rows === undefined) return { ...(tenantId ? { tenantId } : {}),
      sourceKind: "csv", sourceReference: body.sourceReference, csv: body.csv };
  return null;
}
function rollbackBody(value: unknown): RollbackEnterpriseLeadImportRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "expectedVersion"])) return null;
  const tenantId = optionalUuid(body.tenantId);
  const expectedVersion = integer(body.expectedVersion);
  return tenantId !== null && expectedVersion ? {
    ...(tenantId ? { tenantId } : {}), expectedVersion,
  } : null;
}
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function integer(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value >= 1 ? value : null; }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function idempotencyKey(request: FastifyRequest) { const value =
  request.headers["idempotency-key"]; return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
function protectionRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_marketing_phone_protection_required",
  "Enterprise marketing phone protection is not configured"); }
function invalid(reply: FastifyReply, code: string) { return sendError(reply, 400,
  code, "Invalid lead import request"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function notFound(reply: FastifyReply, code = "campaign_not_found") {
  return sendError(reply, 404, code, "Campaign or lead import not found");
}
