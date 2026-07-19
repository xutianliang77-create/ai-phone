import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  EnterpriseMarketingConsentCollectionChannel,
  EnterpriseMarketingConsentEvidenceInput,
  RegisterEnterpriseMarketingConsentRequest,
  RevokeEnterpriseMarketingConsentRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseMarketingConsentEvidenceStore } from
  "./enterprise-marketing-consent-evidence-store.js";
import { enterpriseMarketingConsentPurpose, marketingConsentBlockedReason, marketingConsentDto,
  marketingConsentRegistrationHash, marketingConsentRevocationHash } from
  "./enterprise-marketing-consent.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingConsentRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  evidenceStore: EnterpriseMarketingConsentEvidenceStore,
) {
  app.get<{ Params: { campaignId: string; leadId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/leads/:leadId/consents",
    async (request, reply) => {
      const params = routeParams(request.params);
      if (!params) return invalid(reply, "invalid_marketing_consent_scope");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.consents_list", params.leadId);
      if (!access) return;
      if (!runtime.listMarketingConsents) return postgresRequired(reply);
      const evaluatedAt = new Date().toISOString();
      const result = await runtime.listMarketingConsents({
        context: context(request, access), ...params, evaluatedAt,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({ evaluatedAt, consents: result.consents.map((item) =>
        marketingConsentDto(item, evaluatedAt)) });
    },
  );

  app.get<{ Params: { campaignId: string; leadId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/leads/:leadId/consent-eligibility",
    async (request, reply) => {
      const params = routeParams(request.params);
      if (!params) return invalid(reply, "invalid_marketing_consent_scope");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.consent_eligibility", params.leadId);
      if (!access) return;
      if (!runtime.resolveMarketingConsentEligibility) return postgresRequired(reply);
      const evaluatedAt = new Date().toISOString();
      const result = await runtime.resolveMarketingConsentEligibility({
        context: context(request, access), ...params, evaluatedAt,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return result.status === "eligible"
        ? reply.send({ status: "eligible", evaluatedAt,
            consent: marketingConsentDto(result.consent, evaluatedAt) })
        : reply.send({ status: "blocked", evaluatedAt,
            reasonCode: marketingConsentBlockedReason(result.latest, evaluatedAt) });
    },
  );

  app.post<{ Params: { campaignId: string; leadId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/leads/:leadId/consents",
    async (request, reply) => {
      const params = routeParams(request.params); const body = registerBody(request.body);
      if (!params || !body) return invalid(reply, "invalid_marketing_consent");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.consent_register", params.leadId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      if (!evidenceStore.ready) return evidenceUnavailable(reply,
        evidenceStore.reasonCode ?? "marketing_consent_evidence_store_not_configured");
      const createdAt = new Date().toISOString();
      if (body.grantedAt > createdAt) return invalid(reply, "consent_granted_at_in_future");
      const verification = await evidenceStore.verify({
        tenantId: access.tenant.id, ...body.evidence,
      });
      if (verification.status === "retry") return evidenceUnavailable(
        reply, verification.reasonCode,
      );
      if (verification.status === "rejected") return sendError(reply, 422,
        verification.reasonCode, "Marketing consent evidence rejected");
      if (!runtime.registerMarketingConsent) return postgresRequired(reply);
      const requestHash = marketingConsentRegistrationHash({
        actorUserId: access.account.id, ...params,
        collectionChannel: body.collectionChannel, evidence: body.evidence,
        sourceReference: body.sourceReference, grantedAt: body.grantedAt,
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        consentStatementVersion: body.consentStatementVersion,
      });
      const result = await runtime.registerMarketingConsent({
        context: context(request, access), consent: { id: randomUUID(), ...params,
          collectionChannel: body.collectionChannel, evidence: body.evidence,
          sourceReference: body.sourceReference, grantedAt: body.grantedAt,
          ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
          consentStatementVersion: body.consentStatementVersion,
          idempotencyKey: key, requestHash, createdAt },
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "campaign_not_editable") return sendError(reply, 409,
        "campaign_not_editable", "Only an unsubmitted draft accepts consent evidence");
      if (result.status === "idempotency_conflict") return conflict(reply,
        "idempotency_conflict", "Marketing consent idempotency conflict");
      if (result.status === "evidence_conflict") return conflict(reply,
        "marketing_consent_evidence_conflict", "Evidence object already registered");
      if (!("consent" in result)) return postgresRequired(reply);
      return reply.code(result.status === "created" ? 201 : 200).send({
        consent: marketingConsentDto(result.consent, createdAt),
        ...(result.status === "replayed" ? { replayed: true } : {}),
      });
    },
  );

  app.post<{ Params: { campaignId: string; leadId: string; consentId: string };
    Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/leads/:leadId/consents/:consentId/revoke",
    async (request, reply) => {
      const params = revokeParams(request.params); const body = revokeBody(request.body);
      if (!params || !body) return invalid(reply, "invalid_marketing_consent_revocation");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.consent_revoke", params.consentId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      if (!runtime.revokeMarketingConsent) return postgresRequired(reply);
      const occurredAt = new Date().toISOString();
      const requestHash = marketingConsentRevocationHash({
        actorUserId: access.account.id, ...params,
        expectedVersion: body.expectedVersion, reason: body.reason,
      });
      const result = await runtime.revokeMarketingConsent({
        context: context(request, access), ...params,
        expectedVersion: body.expectedVersion, reason: body.reason,
        idempotencyKey: key, requestHash, occurredAt,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "conflict") return conflict(reply,
        "marketing_consent_version_conflict", "Marketing consent version conflict");
      if (result.status === "idempotency_conflict") return conflict(reply,
        "idempotency_conflict", "Marketing consent revocation conflict");
      if (!("consent" in result)) return postgresRequired(reply);
      return reply.send({ consent: marketingConsentDto(result.consent, occurredAt),
        cancelledTaskCount: result.cancelledTaskCount,
        ...(result.status === "replayed" ? { replayed: true } : {}) });
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_consent", resourceId });
  return access && requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  ) ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) { return createEnterpriseTenantContext({
    tenantId: access.tenant.id, actorUserId: access.account.id,
    actorRole: access.member.role, traceId: enterpriseRequestTraceId(request),
  }); }

function registerBody(value: unknown): RegisterEnterpriseMarketingConsentRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "purpose", "collectionChannel", "evidence",
    "sourceReference", "grantedAt", "expiresAt", "consentStatementVersion"]) ||
    body.purpose !== enterpriseMarketingConsentPurpose ||
    !channels.includes(body.collectionChannel as EnterpriseMarketingConsentCollectionChannel)) {
    return null;
  }
  const tenantId = optionalUuid(body.tenantId); const evidence = evidenceValue(body.evidence);
  const sourceReference = text(body.sourceReference, 200);
  const grantedAt = iso(body.grantedAt); const expiresAt = optionalIso(body.expiresAt);
  const consentStatementVersion = key(body.consentStatementVersion);
  if (tenantId === null || !evidence || !sourceReference || !grantedAt ||
    expiresAt === null || expiresAt && expiresAt <= grantedAt ||
    !consentStatementVersion) return null;
  return { ...(tenantId ? { tenantId } : {}), purpose: enterpriseMarketingConsentPurpose,
    collectionChannel: body.collectionChannel as EnterpriseMarketingConsentCollectionChannel,
    evidence, sourceReference, grantedAt, ...(expiresAt ? { expiresAt } : {}),
    consentStatementVersion };
}
function revokeBody(value: unknown): RevokeEnterpriseMarketingConsentRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "expectedVersion", "reason"])) return null;
  const tenantId = optionalUuid(body.tenantId); const reason = text(body.reason, 500);
  return tenantId !== null && positiveInteger(body.expectedVersion) && reason
    ? { ...(tenantId ? { tenantId } : {}), expectedVersion: body.expectedVersion as number,
        reason } : null;
}
function evidenceValue(value: unknown): EnterpriseMarketingConsentEvidenceInput | null {
  const item = object(value);
  if (!item || !exact(item, ["objectId", "sha256", "sizeBytes", "contentType"])) return null;
  const objectId = uuid(item.objectId); const sha256 = hash(item.sha256);
  return objectId && sha256 && positiveInteger(item.sizeBytes) &&
    (item.sizeBytes as number) <= 25 * 1024 * 1024 &&
    typeof item.contentType === "string" && contentTypes.has(item.contentType)
    ? { objectId, sha256, sizeBytes: item.sizeBytes as number,
        contentType: item.contentType } : null;
}
function routeParams(value: { campaignId: string; leadId: string }) {
  const campaignId = uuid(value.campaignId); const leadId = uuid(value.leadId);
  return campaignId && leadId ? { campaignId, leadId } : null;
}
function revokeParams(value: { campaignId: string; leadId: string; consentId: string }) {
  const scope = routeParams(value); const consentId = uuid(value.consentId);
  return scope && consentId ? { ...scope, consentId } : null;
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every((item) => allowed.includes(item)); }
function text(value: unknown, max: number) { return typeof value === "string" && value === value.trim() && Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= max ? value : null; }
function uuid(value: unknown) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : null; }
function hash(value: unknown) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null; }
function key(value: unknown) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function iso(value: unknown) { if (typeof value !== "string") return null; const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString() === value ? value : null; }
function optionalIso(value: unknown) { return value === undefined ? undefined : iso(value); }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function positiveInteger(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function idempotencyKey(request: FastifyRequest) { const value = request.headers["idempotency-key"]; return typeof value === "string" ? key(value) : null; }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503, "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
function evidenceUnavailable(reply: FastifyReply, reasonCode: string) { return sendError(reply, 503, reasonCode, "Marketing consent evidence store unavailable"); }
function invalid(reply: FastifyReply, code: string) { return sendError(reply, 400, code, "Invalid marketing consent request"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch"); }
function conflict(reply: FastifyReply, code: string, message: string) { return sendError(reply, 409, code, message); }
function notFound(reply: FastifyReply) { return sendError(reply, 404, "marketing_consent_scope_not_found", "Campaign, lead, or consent not found"); }
const channels = ["web_form", "signed_document", "recorded_call", "crm_attestation"] as const;
const contentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "audio/mpeg", "audio/wav", "audio/x-wav", "application/json", "text/plain"]);
