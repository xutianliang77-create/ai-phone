import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from "./enterprise-auth.js";
import type { EnterpriseMarketingPstnProvider } from
  "./enterprise-marketing-pstn-provider.js";
import type { EnterpriseMarketingAgentProvider } from
  "./enterprise-marketing-agent.js";
import { marketingAgentTicketExpiry,
  type EnterpriseMarketingAgentRuntimeBinding } from
  "./enterprise-marketing-agent-ticket.js";
import { marketingPstnIdentity } from "./enterprise-marketing-pstn.js";
import { verifyEnterpriseMarketingPstnWebhook } from
  "./enterprise-marketing-pstn-webhook.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import { decodeTenantRouteDocument, type TenantRouteService } from
  "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingPstnRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseMarketingPstnProvider,
  agentProvider: EnterpriseMarketingAgentProvider,
  agentBinding: EnterpriseMarketingAgentRuntimeBinding) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/pstn-dispatch", async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await requireEnterpriseScope(request, reply, runtime, "campaign:read",
        { action: "marketing_pstn.read", resourceType: "marketing_pstn_dispatch",
          resourceId: campaignId });
      if (!access || !requireTenantRouteDocument(request, reply, routeService,
        access.tenant)) return;
      if (!runtime.getMarketingPstnStatus) return postgresRequired(reply);
      const result = await runtime.getMarketingPstnStatus({ campaignId,
        context: createEnterpriseTenantContext({ tenantId: access.tenant.id,
          actorUserId: access.account.id, actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request) }) });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      const providerReadiness = provider.readiness();
      const readiness = providerReadiness.status === "ready" && !result.protectionReady
        ? { ...providerReadiness, status: "not_ready" as const,
          reasonCode: "phone_protection_not_configured" }
        : providerReadiness;
      return reply.send({ campaignId, dispatches: result.dispatches,
        provider: readiness, billing: { category: "marketing_call_seconds",
          reservedSecondsPerDispatch: 60, settlement: "on_provider_acceptance" } });
    });

  app.post<{ Body: unknown }>("/internal/enterprise/marketing/pstn/dispatch",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const body = dispatchBody(request.body);
      if (!body) return invalid(reply);
      const document = decodeTenantRouteDocument(body.routeDocument);
      if (routeService.verify(document, body).status !== "verified") {
        return routeRejected(reply);
      }
      const readiness = provider.readiness();
      if (readiness.status !== "ready" || readiness.provider === "unavailable" ||
        !readiness.fingerprint) return providerNotReady(reply, readiness.reasonCode);
      const agentReadiness = agentProvider.readiness();
      const runtimeReadiness = agentBinding.readiness();
      if (agentReadiness.status !== "ready") {
        return agentNotReady(reply, agentReadiness.reasonCode);
      }
      if (runtimeReadiness.status !== "ready") {
        return agentNotReady(reply, runtimeReadiness.reasonCode);
      }
      if (!runtime.prepareMarketingPstnDispatch ||
        !runtime.finalizeMarketingPstnDispatch) return postgresRequired(reply);
      const traceId = enterpriseRequestTraceId(request);
      const identity = { tenantId: body.tenantId, taskId: body.taskId,
        generation: body.dispatchGeneration };
      const runId = marketingPstnIdentity({ kind: "agent_run", ...identity });
      const ticket = agentBinding.issue({
        ticketId: marketingPstnIdentity({ kind: "agent_ticket", ...identity }),
        tenantId: body.tenantId, runId,
        dispatchId: marketingPstnIdentity({ kind: "dispatch", ...identity }),
        taskId: body.taskId,
        communicationSessionId: marketingPstnIdentity({ kind: "session",
          tenantId: body.tenantId, taskId: body.taskId, generation: 1 }),
        dispatchGeneration: body.dispatchGeneration, routeEpoch: body.routeEpoch,
        expiresAt: marketingAgentTicketExpiry(),
      });
      const prepared = await runtime.prepareMarketingPstnDispatch({ ...body,
        provider: readiness.provider, providerFingerprint: readiness.fingerprint,
        agentProviderFingerprint: agentReadiness.fingerprint,
        enterpriseAgent: { runtimeUrl: runtimeReadiness.runtimeUrl, ticket,
          runId, disclosureRequired: true }, traceId, now: new Date() });
      if (prepared.status === "storage_required") return postgresRequired(reply);
      if (prepared.status === "route_mismatch") return routeRejected(reply);
      if (prepared.status === "protection_not_ready") {
        return sendError(reply, 503, prepared.status,
          "Enterprise marketing phone protection is not ready");
      }
      if (["agent_profile_not_ready", "agent_content_not_ready",
        "agent_run_conflict"].includes(prepared.status)) {
        return agentNotReady(reply, prepared.status);
      }
      if (prepared.status === "already_accepted") {
        return reply.send(response("already_accepted", prepared.dispatch));
      }
      if (prepared.status !== "prepared") return dispatchRejected(reply, prepared.status);
      const providerResult = await provider.dispatch(prepared.request);
      const finalized = await runtime.finalizeMarketingPstnDispatch({
        tenantId: body.tenantId, dispatchId: prepared.dispatch.id,
        result: providerResult, traceId, now: new Date() });
      if (finalized.status === "storage_required") return postgresRequired(reply);
      if (finalized.status === "billing_rejected") return sendError(reply, 503,
        "marketing_pstn_billing_reconciliation_required",
        "PSTN dispatch requires billing reconciliation");
      if (finalized.status === "not_found") return notFound(reply);
      if (finalized.status === "failed") return sendError(reply, 503,
        "marketing_pstn_provider_failed", "PSTN provider rejected dispatch");
      if (!("dispatch" in finalized)) return postgresRequired(reply);
      const status = finalized.status === "reconciliation_required"
        ? "reconciliation_required" : finalized.status === "already_accepted"
        ? "already_accepted" : "accepted";
      return reply.status(status === "reconciliation_required" ? 202 : 200)
        .send(response(status, finalized.dispatch));
    });

  app.post<{ Body: unknown }>("/webhooks/enterprise/marketing/pstn",
    async (request, reply) => {
      const verified = verifyEnterpriseMarketingPstnWebhook({ body: request.body,
        signature: single(request.headers["x-translation-enterprise-pstn-signature"]) });
      if (verified.status === "not_configured") return sendError(reply, 503,
        "marketing_pstn_webhook_not_configured", "PSTN webhook is not configured");
      if (verified.status === "invalid_body") return invalid(reply);
      if (verified.status === "invalid_signature") return unauthorized(reply);
      if (!runtime.ingestMarketingPstnWebhook) return postgresRequired(reply);
      const result = await runtime.ingestMarketingPstnWebhook({ event: verified.body,
        traceId: enterpriseRequestTraceId(request), now: new Date() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "route_mismatch") return routeRejected(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "billing_rejected") return sendError(reply, 503,
        "marketing_pstn_billing_reconciliation_required",
        "PSTN webhook requires billing reconciliation");
      if (result.status === "event_conflict") return sendError(reply, 409,
        "marketing_pstn_event_conflict", "PSTN event replay payload conflicts");
      return reply.send({ status: result.status });
    });
}

function response(status: "accepted" | "already_accepted" | "reconciliation_required",
  dispatch: { id: string; communicationSessionId: string; dispatchGeneration: number;
    provider: "pstn_http" | "pstn_fonoster"; providerCallId?: string }) {
  return { status, dispatchId: dispatch.id,
    communicationSessionId: dispatch.communicationSessionId,
    dispatchGeneration: dispatch.dispatchGeneration, provider: dispatch.provider,
    ...(dispatch.providerCallId ? { providerCallId: dispatch.providerCallId } : {}) };
}
function dispatchBody(value: unknown) { const body = object(value);
  const keys = ["tenantId", "homeRegion", "cellId", "routeEpoch", "routeDocument",
    "taskId", "dispatchGeneration", "claimToken"];
  if (!body || Object.keys(body).sort().join(",") !== keys.sort().join(",")) return null;
  const tenantId = uuid(body.tenantId); const taskId = uuid(body.taskId);
  const homeRegion = code(body.homeRegion, 64); const cellId = code(body.cellId, 64);
  const routeEpoch = positive(body.routeEpoch); const dispatchGeneration =
    positive(body.dispatchGeneration); const routeDocument = text(body.routeDocument, 4_096);
  const claimToken = typeof body.claimToken === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(body.claimToken) ? body.claimToken : null;
  return tenantId && taskId && homeRegion && cellId && routeEpoch && dispatchGeneration &&
    routeDocument && claimToken ? { tenantId, taskId, homeRegion, cellId, routeEpoch,
      dispatchGeneration, routeDocument, claimToken } : null; }
function internalAuthorized(request: FastifyRequest) { const expected = Buffer.from(
  process.env.INTERNAL_API_SECRET?.trim() ?? ""); const header = request.headers.authorization;
  const supplied = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied); }
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function text(value: unknown, max: number) { return typeof value === "string" &&
  value.length <= max && value.length > 0 ? value : null; }
function code(value: unknown, max: number) { return typeof value === "string" &&
  value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null; }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function positive(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value > 0 ? value : null; }
function single(value: string | string[] | undefined) { return Array.isArray(value)
  ? value[0] : value; }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401,
  "internal_error", "Unauthorized request"); }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_pstn_request", "Invalid marketing PSTN request"); }
function routeRejected(reply: FastifyReply) { return sendError(reply, 409,
  "marketing_pstn_route_rejected", "Marketing PSTN route rejected"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "marketing_pstn_not_found", "Marketing PSTN resource not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
function providerNotReady(reply: FastifyReply, reason?: string) { return sendError(reply,
  503, "marketing_pstn_provider_not_ready", reason ?? "PSTN provider is not ready"); }
function agentNotReady(reply: FastifyReply, reason?: string) { return sendError(reply,
  503, "marketing_agent_not_ready", reason ?? "Marketing Agent is not ready"); }
function dispatchRejected(reply: FastifyReply, reason: string) { return sendError(reply,
  409, `marketing_pstn_${reason}`, "Marketing PSTN dispatch rejected"); }
