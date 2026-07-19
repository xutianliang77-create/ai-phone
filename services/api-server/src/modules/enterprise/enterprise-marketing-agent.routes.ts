import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UpsertEnterpriseMarketingAgentProfileRequest } from
  "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { enterpriseMarketingAgentHash,
  enterpriseMarketingAgentScriptTextIsSafe,
  type EnterpriseMarketingAgentProvider } from "./enterprise-marketing-agent.js";
import type { EnterpriseMarketingAgentRuntimeBinding } from
  "./enterprise-marketing-agent-ticket.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { registerEnterpriseMarketingAgentProviderRoutes } from
  "./enterprise-marketing-agent-provider.routes.js";

export function registerEnterpriseMarketingAgentRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseMarketingAgentProvider,
  binding: EnterpriseMarketingAgentRuntimeBinding) {
  registerEnterpriseMarketingAgentProviderRoutes(app, runtime, provider, binding);
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/marketing-agent",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "marketing_agent.read", campaignId);
      if (!access) return;
      if (!runtime.listMarketingAgentProfiles) return postgresRequired(reply);
      const result = await runtime.listMarketingAgentProfiles({ campaignId,
        context: context(request, access) });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({ campaignId, profiles: result.profiles,
        provider: readiness(provider.readiness()), runtime: readiness(binding.readiness()) });
    });

  app.put<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/marketing-agent/profiles",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId); const body = profileBody(request.body);
      if (!campaignId || !body) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "marketing_agent.profile.upsert", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      const idempotencyKey = commandKey(request);
      if (!idempotencyKey) return invalid(reply);
      if (!runtime.upsertMarketingAgentProfile) return postgresRequired(reply);
      const { tenantId: _tenantId, expectedVersion, ...profile } = body;
      const result = await runtime.upsertMarketingAgentProfile({
        context: context(request, access), campaignId, profileId: randomUUID(),
        idempotencyKey, requestHash: enterpriseMarketingAgentHash({
          actorUserId: access.account.id, campaignId, expectedVersion, profile }),
        occurredAt: new Date().toISOString(), profile,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "not_editable") return sendError(reply, 409,
        "marketing_agent_profile_not_editable",
        "Marketing Agent profiles can only change before campaign approval");
      if (result.status === "version_conflict") return sendError(reply, 409,
        "marketing_agent_profile_version_conflict", "Marketing Agent profile conflict");
      if (result.status === "idempotency_conflict") return sendError(reply, 409,
        "idempotency_conflict", "Marketing Agent idempotency conflict");
      return reply.status(result.status === "created" ? 201 : 200).send(result);
    });
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_agent_profile", resourceId });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) { return createEnterpriseTenantContext({
  tenantId: access.tenant.id, actorUserId: access.account.id,
  actorRole: access.member.role, traceId: enterpriseRequestTraceId(request) }); }
function profileBody(value: unknown): UpsertEnterpriseMarketingAgentProfileRequest | null {
  const body = object(value); const keys = ["tenantId", "expectedVersion", "countryCode",
    "locale", "brandName", "agentIdentity", "callPurpose", "productCode", "valueProposition",
    "targetMarket", "termPackId", "scriptTemplateId", "voicePresetId",
    "openingDisclosure", "qualificationQuestions", "optOutPhrases", "handoffPhrases",
    "closingText"];
  if (!body || !Object.keys(body).every((key) => keys.includes(key))) return null;
  const tenantId = optionalUuid(body.tenantId); const expectedVersion = body.expectedVersion ===
    undefined ? undefined : integer(body.expectedVersion);
  const countryCode = code(body.countryCode, /^[A-Z]{2}$/); const locale = code(body.locale,
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/); const productCode = code(body.productCode,
    /^[a-z0-9][a-z0-9._-]{0,79}$/); const voicePresetId = code(body.voicePresetId,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
  const qualificationQuestions = phrases(body.qualificationQuestions, 20);
  const optOutPhrases = phrases(body.optOutPhrases, 40);
  const handoffPhrases = phrases(body.handoffPhrases, 40);
  const result = { tenantId, expectedVersion, countryCode, locale, productCode,
    voicePresetId, brandName: text(body.brandName, 200),
    agentIdentity: text(body.agentIdentity, 500),
    callPurpose: text(body.callPurpose, 1_000),
    valueProposition: text(body.valueProposition, 2_000),
    targetMarket: text(body.targetMarket, 1_000), termPackId: uuid(body.termPackId),
    scriptTemplateId: uuid(body.scriptTemplateId),
    openingDisclosure: text(body.openingDisclosure, 2_000),
    qualificationQuestions, optOutPhrases, handoffPhrases,
    closingText: text(body.closingText, 2_000) };
  if (Object.values(result).some((item) => item === null) || !countryCode || !locale ||
    !productCode || !voicePresetId || !qualificationQuestions || !optOutPhrases ||
    !handoffPhrases || !disclosureIncludes(result) || ![result.openingDisclosure,
      result.closingText, ...qualificationQuestions].every((item) =>
      item && enterpriseMarketingAgentScriptTextIsSafe(item))) return null;
  return Object.fromEntries(Object.entries(result).filter(([, item]) => item !== undefined)) as
    unknown as UpsertEnterpriseMarketingAgentProfileRequest;
}
function disclosureIncludes(value: { brandName: string | null; agentIdentity: string | null;
  callPurpose: string | null; openingDisclosure: string | null }) {
  if (!value.brandName || !value.agentIdentity || !value.callPurpose ||
    !value.openingDisclosure) return false;
  const disclosure = value.openingDisclosure.toLocaleLowerCase();
  return [value.brandName, value.agentIdentity, value.callPurpose]
    .every((item) => disclosure.includes(item.toLocaleLowerCase()));
}
function readiness(value: { status: string; fingerprint?: string; runtimeUrl?: string;
  reasonCode?: string }) { return value.status === "ready"
  ? { status: "ready" as const, ...(value.fingerprint
    ? { providerFingerprint: value.fingerprint } : {}) }
  : { status: value.status === "not_ready" ? "not_ready" as const
    : "not_configured" as const, reasonCode: value.reasonCode ?? "not_configured" }; }
function phrases(value: unknown, max: number) { if (!Array.isArray(value) || value.length < 1 ||
  value.length > max) return null; const items = value.map((item) => text(item, 500));
  return items.every(Boolean) && new Set(items).size === items.length ? items as string[] : null; }
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : null; }
function text(value: unknown, max: number) { return typeof value === "string" &&
  value === value.trim() && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= max
  ? value : null; }
function code(value: unknown, pattern: RegExp) { return typeof value === "string" &&
  pattern.test(value) ? value : null; }
function integer(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value > 0 ? value : null; }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ? value : null; }
function commandKey(request: FastifyRequest) { const value = request.headers["idempotency-key"];
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value : null; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_agent_request", "Invalid Marketing Agent request"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 403,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "marketing_agent_not_found", "Marketing Agent resource not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
