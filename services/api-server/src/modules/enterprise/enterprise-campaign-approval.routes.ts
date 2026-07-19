import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseCampaignDto } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { campaignApprovalCommandHash, campaignApprovalDecisionDto,
  campaignValidationSnapshotDto } from "./enterprise-campaign-approval.js";
import type { EnterpriseCampaignRecord } from "./enterprise-campaign.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseCampaignApprovalRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/approval",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.approval_read", campaignId);
      if (!access) return;
      if (!runtime.getCampaignApproval) return postgresRequired(reply);
      const result = await runtime.getCampaignApproval({
        context: context(request, access), campaignId });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({
        ...(result.latestValidation ? { latestValidation:
          campaignValidationSnapshotDto(result.latestValidation) } : {}),
        decisions: result.decisions.map(campaignApprovalDecisionDto),
      });
    },
  );

  app.post<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/approval/validate",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const body = validateBody(request.body); const key = idempotencyKey(request);
      if (!campaignId || !body || !key) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.approval_validate", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.validateCampaign) return postgresRequired(reply);
      const requestHash = campaignApprovalCommandHash({ actorUserId: access.account.id,
        campaignId, command: "validate", expectedVersion: body.expectedVersion });
      const result = await runtime.validateCampaign({ context: context(request, access),
        campaignId, expectedVersion: body.expectedVersion, validationId: randomUUID(),
        idempotencyKey: key, requestHash, validatedAt: new Date().toISOString() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "conflict") return conflict(reply, "campaign_version_conflict");
      if (result.status === "not_validatable") return conflict(reply,
        "campaign_not_validatable");
      if (result.status === "idempotency_conflict") return conflict(reply,
        "idempotency_conflict");
      if (!("validation" in result)) return conflict(reply, "campaign_validation_conflict");
      return reply.code(result.status === "created" ? 201 : 200).send({
        validation: campaignValidationSnapshotDto(result.validation),
        ...(result.campaign ? { campaign: campaignDto(result.campaign) } : {}),
        ...(result.status === "replayed" ? { replayed: true } : {}),
      });
    },
  );

  app.post<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/approval/approve",
    async (request, reply) => decide(request, reply, routeService, runtime, "approve"),
  );
  app.post<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/approval/reject",
    async (request, reply) => decide(request, reply, routeService, runtime, "reject"),
  );
}

async function decide(request: FastifyRequest<{ Params: { campaignId: string };
  Body: unknown }>, reply: FastifyReply, routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime, command: "approve" | "reject") {
  const campaignId = uuid(request.params.campaignId);
  const body = decisionBody(request.body, command); const key = idempotencyKey(request);
  if (!campaignId || !body || !key) return invalid(reply);
  const access = await authorized(request, reply, routeService, runtime,
    "campaign:approve", `campaign.${command}`, campaignId);
  if (!access) return;
  if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
  const method = command === "approve" ? runtime.approveCampaign : runtime.rejectCampaign;
  if (!method) return postgresRequired(reply);
  const reason = "reason" in body ? body.reason : undefined;
  const requestHash = campaignApprovalCommandHash({ actorUserId: access.account.id,
    campaignId, command, expectedVersion: body.expectedVersion,
    validationSnapshotId: body.validationSnapshotId, ...(reason ? { reason } : {}) });
  const common = { context: context(request, access), campaignId,
    expectedVersion: body.expectedVersion,
    validationSnapshotId: body.validationSnapshotId, decisionId: randomUUID(),
    idempotencyKey: key, requestHash, decidedAt: new Date().toISOString() };
  const result = command === "approve"
    ? await runtime.approveCampaign!(common)
    : await runtime.rejectCampaign!({ ...common, reason: reason! });
  if (result.status === "storage_required") return postgresRequired(reply);
  if (result.status === "not_found") return notFound(reply);
  if (["conflict", "not_decidable", "validation_stale", "idempotency_conflict"]
    .includes(result.status)) return conflict(reply, `campaign_${result.status}`);
  if (!("decision" in result) || !("campaign" in result)) {
    return conflict(reply, "campaign_decision_conflict");
  }
  return reply.code(result.status === "replayed" ? 200 : 201).send({
    decision: campaignApprovalDecisionDto(result.decision),
    campaign: campaignDto(result.campaign),
    ...(result.status === "replayed" ? { replayed: true } : {}),
  });
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write" | "campaign:approve", action: string,
  resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "campaign_approval", resourceId });
  return access && requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  ) ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) { return createEnterpriseTenantContext({
  tenantId: access.tenant.id, actorUserId: access.account.id,
  actorRole: access.member.role, traceId: enterpriseRequestTraceId(request) }); }
function validateBody(value: unknown) { const body = object(value);
  if (!body || !exact(body, ["tenantId", "expectedVersion"])) return null;
  const tenantId = optionalUuid(body.tenantId); const expectedVersion = positive(body.expectedVersion);
  return tenantId !== null && expectedVersion ? { ...(tenantId ? { tenantId } : {}),
    expectedVersion } : null; }
function decisionBody(value: unknown, command: "approve" | "reject") {
  const body = object(value); const allowed = command === "approve"
    ? ["tenantId", "expectedVersion", "validationSnapshotId"]
    : ["tenantId", "expectedVersion", "validationSnapshotId", "reason"];
  if (!body || !exact(body, allowed)) return null;
  const tenantId = optionalUuid(body.tenantId); const expectedVersion = positive(body.expectedVersion);
  const validationSnapshotId = uuid(body.validationSnapshotId);
  const reason = command === "reject" ? text(body.reason, 1_000) : undefined;
  return tenantId !== null && expectedVersion && validationSnapshotId &&
    (command === "approve" || reason) ? { ...(tenantId ? { tenantId } : {}),
      expectedVersion, validationSnapshotId, ...(reason ? { reason } : {}) } : null;
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key)); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function positive(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value > 0 ? value : null; }
function text(value: unknown, max: number) { return typeof value === "string" &&
  value === value.trim() && Buffer.byteLength(value) >= 1 &&
  Buffer.byteLength(value) <= max ? value : null; }
function idempotencyKey(request: FastifyRequest) { const value = request.headers["idempotency-key"];
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value : null; }
function campaignDto(value: EnterpriseCampaignRecord): EnterpriseCampaignDto {
  const { tenantId: _tenantId, ...dto } = value; return dto; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_campaign_approval", "Invalid campaign approval request"); }
function conflict(reply: FastifyReply, code: string) { return sendError(reply, 409,
  code, "Campaign approval conflict"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "campaign_not_found", "Campaign not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
