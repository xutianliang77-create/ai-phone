import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateEnterpriseCampaignRequest,
  EnterpriseCampaignDto,
  EnterpriseCampaignScheduleDto,
  UpdateEnterpriseCampaignRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { campaignCommandRequestHash, campaignRequestHash,
  type EnterpriseCampaignRecord } from
  "./enterprise-campaign.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseCampaignRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/campaigns", async (request, reply) => {
    const access = await authorized(request, reply, routeService, runtime,
      "campaign:read", "campaign.list");
    if (!access) return;
    if (!runtime.listCampaigns) return postgresRequired(reply);
    const result = await runtime.listCampaigns({ context: context(request, access) });
    return result.status === "ready"
      ? reply.send({ campaigns: result.campaigns.map(campaignDto) })
      : postgresRequired(reply);
  });

  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply, "invalid_campaign_id");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.read", campaignId);
      if (!access) return;
      if (!runtime.getCampaign) return postgresRequired(reply);
      const result = await runtime.getCampaign({
        context: context(request, access), campaignId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      return result.status === "not_found" ? notFound(reply)
        : reply.send({ campaign: campaignDto(result.campaign) });
    },
  );

  app.post<{ Body: unknown }>("/enterprise/v1/campaigns", async (request, reply) => {
    const access = await authorized(request, reply, routeService, runtime,
      "campaign:write", "campaign.create");
    if (!access) return;
    if (!runtime.createCampaign) return postgresRequired(reply);
    const body = createBody(request.body);
    const key = idempotencyKey(request);
    if (!body) return invalid(reply, "invalid_campaign");
    if (!key) return invalid(reply, "idempotency_key_required");
    if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
    const { tenantId: _tenantId, ...campaign } = body;
    const createdAt = new Date().toISOString();
    const result = await runtime.createCampaign({
      context: context(request, access),
      campaign: { ...campaign, id: randomUUID(), ownerUserId: access.account.id,
        createdAt, idempotencyKey: key,
        requestHash: campaignRequestHash({ ownerUserId: access.account.id,
          campaign }) },
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    if (result.status === "idempotency_conflict") return sendError(reply, 409,
      "idempotency_conflict", "Campaign idempotency conflict");
    return reply.code(result.status === "created" ? 201 : 200).send({
      campaign: campaignDto(result.campaign),
      ...(result.status === "replayed" ? { replayed: true } : {}),
    });
  });

  app.patch<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const body = updateBody(request.body);
      if (!campaignId || !body) return invalid(reply, "invalid_campaign_update");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.draft_update", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.updateCampaignDraft) return postgresRequired(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      const { tenantId: _tenantId, expectedVersion, ...patch } = body;
      const result = await runtime.updateCampaignDraft({
        context: context(request, access), campaignId, expectedVersion, patch,
        idempotencyKey: key, requestHash: campaignCommandRequestHash({
          actorUserId: access.account.id, campaignId, command: "draft_update",
          expectedVersion, patch,
        }),
        updatedAt: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "conflict") return sendError(reply, 409,
        "campaign_version_conflict", "Campaign version conflict");
      if (result.status === "idempotency_conflict") return sendError(reply, 409,
        "idempotency_conflict", "Campaign idempotency conflict");
      if (result.status === "not_editable") return sendError(reply, 409,
        "campaign_not_editable", "Only an unsubmitted draft can be edited");
      if (!("campaign" in result)) return postgresRequired(reply);
      return reply.send({ campaign: campaignDto(result.campaign),
        ...(result.status === "replayed" ? { replayed: true } : {}) });
    },
  );

  app.post<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/schedule",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const body = scheduleBody(request.body);
      if (!campaignId || !body) return invalid(reply, "invalid_campaign_schedule");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:approve", "campaign.schedule", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.scheduleCampaign) return postgresRequired(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      const result = await runtime.scheduleCampaign({ context: context(request, access),
        campaignId, expectedVersion: body.expectedVersion,
        idempotencyKey: key, requestHash: campaignCommandRequestHash({
          actorUserId: access.account.id, campaignId, command: "schedule",
          expectedVersion: body.expectedVersion,
        }),
        occurredAt: new Date().toISOString() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "conflict") return sendError(reply, 409,
        "campaign_version_conflict", "Campaign version conflict");
      if (result.status === "idempotency_conflict") return sendError(reply, 409,
        "idempotency_conflict", "Campaign idempotency conflict");
      if (result.status === "blocked") return sendError(reply, 409,
        `campaign_${result.reasonCode}`, `Campaign scheduling blocked: ${result.reasonCode}`);
      if (!("campaign" in result)) return postgresRequired(reply);
      return reply.send({ campaign: campaignDto(result.campaign),
        ...(result.generatedTaskCount !== undefined
          ? { generatedTaskCount: result.generatedTaskCount } : {}),
        ...(result.status === "replayed" ? { replayed: true } : {}) });
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write" | "campaign:approve", action: string,
  resourceId?: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "campaign", ...(resourceId ? { resourceId } : {}) });
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
function createBody(value: unknown): CreateEnterpriseCampaignRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "name", "objective", "countryCodes",
    "languageCodes", "schedule", "concurrencyLimit"])) return null;
  const tenantId = optionalUuid(body.tenantId);
  const name = text(body.name, 200); const objective = text(body.objective, 2_000);
  const countryCodes = codes(body.countryCodes, /^[A-Z]{2}$/);
  const languageCodes = codes(body.languageCodes,
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
  const schedule = scheduleValue(body.schedule);
  const concurrencyLimit = integer(body.concurrencyLimit, 1, 100);
  return tenantId !== null && name && objective && countryCodes && languageCodes &&
    schedule && concurrencyLimit ? { ...(tenantId ? { tenantId } : {}), name,
      objective, countryCodes, languageCodes, schedule, concurrencyLimit } : null;
}
function updateBody(value: unknown): UpdateEnterpriseCampaignRequest | null {
  const body = object(value); const allowed = ["tenantId", "expectedVersion", "name",
    "objective", "countryCodes", "languageCodes", "schedule", "concurrencyLimit"];
  if (!body || !exact(body, allowed) || Object.keys(body).every((key) =>
    key === "tenantId" || key === "expectedVersion")) return null;
  const expectedVersion = integer(body.expectedVersion, 1, Number.MAX_SAFE_INTEGER);
  const tenantId = optionalUuid(body.tenantId);
  const name = body.name === undefined ? undefined : text(body.name, 200);
  const objective = body.objective === undefined ? undefined : text(body.objective, 2_000);
  const countryCodes = body.countryCodes === undefined ? undefined
    : codes(body.countryCodes, /^[A-Z]{2}$/);
  const languageCodes = body.languageCodes === undefined ? undefined
    : codes(body.languageCodes, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
  const schedule = body.schedule === undefined ? undefined : scheduleValue(body.schedule);
  const concurrencyLimit = body.concurrencyLimit === undefined ? undefined
    : integer(body.concurrencyLimit, 1, 100);
  if (!expectedVersion || tenantId === null || name === null || objective === null ||
    countryCodes === null || languageCodes === null || schedule === null ||
    concurrencyLimit === null) return null;
  return { ...(tenantId ? { tenantId } : {}), expectedVersion,
    ...(name ? { name } : {}), ...(objective ? { objective } : {}),
    ...(countryCodes ? { countryCodes } : {}),
    ...(languageCodes ? { languageCodes } : {}), ...(schedule ? { schedule } : {}),
    ...(concurrencyLimit ? { concurrencyLimit } : {}) };
}
function scheduleBody(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "expectedVersion"])) return null;
  const tenantId = optionalUuid(body.tenantId);
  const expectedVersion = integer(body.expectedVersion, 1, Number.MAX_SAFE_INTEGER);
  return tenantId !== null && expectedVersion
    ? { ...(tenantId ? { tenantId } : {}), expectedVersion } : null;
}
function scheduleValue(value: unknown): EnterpriseCampaignScheduleDto | null {
  const item = object(value);
  if (!item || !exact(item, ["timezone", "startAt", "endAt"]) ||
    typeof item.timezone !== "string" || item.timezone !== item.timezone.trim() ||
    item.timezone.length > 64 || !timezone(item.timezone)) return null;
  const startAt = optionalIso(item.startAt); const endAt = optionalIso(item.endAt);
  if (startAt === null || endAt === null || startAt && endAt && endAt <= startAt) return null;
  return { timezone: item.timezone, ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}) };
}
function codes(value: unknown, pattern: RegExp) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null;
  const items = value.map((item) => typeof item === "string" && pattern.test(item)
    ? item : null);
  return items.every(Boolean) && new Set(items).size === items.length
    ? items as string[] : null;
}
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function text(value: unknown, max: number) { return typeof value === "string" &&
  value === value.trim() && Buffer.byteLength(value) >= 1 &&
  Buffer.byteLength(value) <= max ? value : null; }
function integer(value: unknown, min: number, max: number) { return typeof value ===
  "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null; }
function optionalIso(value: unknown) { if (value === undefined) return undefined;
  if (typeof value !== "string") return null; const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : null; }
function timezone(value: string) { try { new Intl.DateTimeFormat("en", {
  timeZone: value }).format(); return true; } catch { return false; } }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function idempotencyKey(request: FastifyRequest) { const value =
  request.headers["idempotency-key"]; return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function campaignDto(item: EnterpriseCampaignRecord): EnterpriseCampaignDto {
  const { tenantId: _tenantId, ...dto } = item; return dto;
}
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
function invalid(reply: FastifyReply, code: string) { return sendError(reply, 400,
  code, "Invalid campaign request"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "campaign_not_found", "Campaign not found"); }
