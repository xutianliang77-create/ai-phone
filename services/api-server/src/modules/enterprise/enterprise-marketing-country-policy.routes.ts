import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PublishEnterpriseCountryPolicyRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { countryPolicyContentHash, countryPolicyCreationHash,
  enterpriseCountryPolicyDto, prepareEnterpriseCountryPolicy } from
  "./enterprise-marketing-country-policy.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingCountryPolicyRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/marketing/country-policies", async (request, reply) => {
    const access = await authorized(request, reply, routeService, runtime,
      "campaign:read", "campaign.country_policy_list");
    if (!access) return;
    if (!runtime.listCountryPolicies) return postgresRequired(reply);
    const result = await runtime.listCountryPolicies({
      context: context(request, access),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    const evaluatedAt = new Date().toISOString();
    return reply.send({ evaluatedAt,
      policies: result.policies.map((policy) =>
        enterpriseCountryPolicyDto(policy, evaluatedAt)) });
  });

  app.post<{ Body: unknown }>(
    "/enterprise/v1/marketing/country-policies",
    async (request, reply) => {
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:approve", "campaign.country_policy_publish");
      if (!access) return;
      const body = policyBody(request.body);
      const idempotency = idempotencyKey(request);
      if (!body) return invalid(reply);
      if (!idempotency) return sendError(reply, 400, "idempotency_key_required",
        "Country policy idempotency key required");
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.publishCountryPolicy) return postgresRequired(reply);
      const publishedAt = new Date().toISOString();
      let policy: ReturnType<typeof prepareEnterpriseCountryPolicy>;
      try {
        const { tenantId: _tenantId, ...candidate } = body;
        policy = prepareEnterpriseCountryPolicy(candidate, publishedAt);
      } catch {
        return invalid(reply);
      }
      const contentHash = countryPolicyContentHash(policy);
      const creationRequestHash = countryPolicyCreationHash({
        actorUserId: access.account.id, policy,
      });
      const result = await runtime.publishCountryPolicy({
        context: context(request, access), policy: { id: randomUUID(), ...policy,
          contentHash, publishedBy: access.account.id, publishedAt,
          creationRequestHash, idempotencyKey: idempotency },
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "idempotency_conflict") return conflict(reply,
        "idempotency_conflict");
      if (result.status === "policy_version_conflict") return conflict(reply,
        "country_policy_version_conflict");
      if (result.status === "effective_window_conflict") return conflict(reply,
        "country_policy_effective_window_conflict");
      if (!("policy" in result)) return conflict(reply, "country_policy_conflict");
      return reply.code(result.status === "created" ? 201 : 200).send({
        policy: enterpriseCountryPolicyDto(result.policy, publishedAt),
        ...(result.status === "replayed" ? { replayed: true } : {}),
      });
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/country-policy-readiness",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.country_policy_readiness", campaignId);
      if (!access) return;
      if (!runtime.resolveCampaignCountryPolicies) return postgresRequired(reply);
      const evaluatedAt = new Date().toISOString();
      const result = await runtime.resolveCampaignCountryPolicies({
        context: context(request, access), campaignId, evaluatedAt,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return sendError(reply, 404,
        "campaign_not_found", "Campaign not found");
      return reply.send({ status: result.status, evaluatedAt,
        targetAt: result.targetAt, issues: result.issues,
        policies: result.policies.map((policy) =>
          enterpriseCountryPolicyDto(policy, result.targetAt)) });
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:approve", action: string,
  resourceId?: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_country_policy",
      ...(resourceId ? { resourceId } : {}) });
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
function policyBody(value: unknown): PublishEnterpriseCountryPolicyRequest | null {
  const body = object(value); if (!body || !exact(body, ["tenantId", "countryCode",
    "policyVersion", "callingWindows", "maxAttempts", "frequencyWindowHours",
    "minRetryIntervalMinutes", "disclosure", "voicemail", "complianceReference",
    "effectiveFrom", "expiresAt"])) return null;
  const disclosure = object(body.disclosure); const voicemail = object(body.voicemail);
  if (!disclosure || !exact(disclosure, ["version", "brand", "aiIdentity",
    "marketingPurpose"]) || !voicemail || !exact(voicemail, ["mode", "version",
    "message"]) || !Array.isArray(body.callingWindows)) return null;
  const callingWindows = body.callingWindows.map((item) => object(item));
  if (callingWindows.some((item) => !item || !exact(item, ["weekday", "startMinute",
    "endMinute"]))) return null;
  if (![body.countryCode, body.policyVersion, body.complianceReference,
    body.effectiveFrom, body.expiresAt, disclosure.version, disclosure.brand,
    disclosure.aiIdentity, disclosure.marketingPurpose]
    .every((item) => typeof item === "string") ||
    ![body.maxAttempts, body.frequencyWindowHours, body.minRetryIntervalMinutes]
      .every((item) => typeof item === "number") || typeof voicemail.mode !== "string") {
    return null;
  }
  const tenantId = body.tenantId === undefined ? undefined : uuid(body.tenantId);
  if (body.tenantId !== undefined && !tenantId) return null;
  return { ...(tenantId ? { tenantId } : {}), countryCode: body.countryCode as string,
    policyVersion: body.policyVersion as string,
    callingWindows: callingWindows as unknown as
      PublishEnterpriseCountryPolicyRequest["callingWindows"],
    maxAttempts: body.maxAttempts as number,
    frequencyWindowHours: body.frequencyWindowHours as number,
    minRetryIntervalMinutes: body.minRetryIntervalMinutes as number,
    disclosure: disclosure as unknown as PublishEnterpriseCountryPolicyRequest["disclosure"],
    voicemail: voicemail as unknown as PublishEnterpriseCountryPolicyRequest["voicemail"],
    complianceReference: body.complianceReference as string,
    effectiveFrom: body.effectiveFrom as string, expiresAt: body.expiresAt as string };
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function idempotencyKey(request: FastifyRequest) { const value =
  request.headers["idempotency-key"]; return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_country_policy", "Invalid country policy request"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function conflict(reply: FastifyReply, code: string) { return sendError(reply, 409,
  code, "Country policy conflict"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
