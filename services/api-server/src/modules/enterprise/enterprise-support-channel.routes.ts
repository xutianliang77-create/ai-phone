import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseProviderReadinessService } from
  "./enterprise-provider-readiness.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type { EnterpriseSupportInboundEvent } from
  "./enterprise-support-inbound.js";
import type { EnterpriseSupportInboundTicketService } from
  "./enterprise-support-inbound-ticket.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseSupportChannelRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  readiness: EnterpriseProviderReadinessService,
  tickets: EnterpriseSupportInboundTicketService,
) {
  app.post("/enterprise/v1/support/channels", async (request, reply) => {
    const access = await requireEnterpriseScope(request, reply, runtime,
      "support:manage", { action: "support.channel.create",
        resourceType: "support_channel" });
    if (!access || !requireTenantRouteDocument(
      request, reply, routeService, access.tenant,
    )) return;
    const body = channelRequest(request.body);
    if (!body) return invalid(reply, "invalid_support_channel");
    if (!runtime.createSupportChannel) return postgresRequired(reply);
    if (body.status === "active" && !await channelReady(
      readiness, access.tenant.homeRegion, body.channelType, body.provider,
    )) return notReady(reply, "channel_provider_not_ready");
    const result = await runtime.createSupportChannel({
      context: createEnterpriseTenantContext({ tenantId: access.tenant.id,
        actorUserId: access.account.id, actorRole: access.member.role,
        traceId: enterpriseRequestTraceId(request) }),
      channel: { ...body, createdAt: new Date().toISOString() },
    });
    if (result.status === "created") return reply.status(201).send({ channel: {
      id: result.channel.id, channelType: result.channel.channelType,
      provider: result.channel.provider, status: result.channel.status,
      createdAt: result.channel.createdAt, updatedAt: result.channel.updatedAt,
      version: result.channel.version,
    } });
    if (result.status === "conflict") return sendError(reply, 409,
      "support_channel_conflict", "Support channel already exists");
    return postgresRequired(reply);
  });

  app.post("/internal/enterprise/support/channels/authorize",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const body = authorizationRequest(request.body);
      if (!body) return invalid(reply, "invalid_support_channel_authorization");
      if (!runtime.authorizeSupportInboundChannel) return postgresRequired(reply);
      const context = createEnterpriseTenantContext({ tenantId: body.tenantId,
        actorUserId: "service:support_ingress",
        traceId: enterpriseRequestTraceId(request) });
      const result = await runtime.authorizeSupportInboundChannel({
        context, channelId: body.channelId, channelType: body.channelType,
      });
      if (result.status !== "ready") return runtimeFailure(reply, result.status);
      if (!await channelReady(readiness, result.authorization.route.homeRegion,
        result.authorization.channel.channelType,
        result.authorization.channel.provider)) {
        return notReady(reply, "channel_provider_not_ready");
      }
      const issued = tickets.issue(result.authorization.route);
      return issued.status === "ready" ? reply.send(issued) :
        notReady(reply, "support_ingress_signing_not_configured");
    });

  app.post("/internal/enterprise/support/inbound", async (request, reply) => {
    if (!internalAuthorized(request)) return unauthorized(reply);
    const body = inboundRequest(request.body);
    if (!body) return invalid(reply, "invalid_support_inbound_event");
    const verified = tickets.verify(body.ticket);
    if (verified.status !== "verified") return sendError(reply, 403,
      "support_inbound_ticket_rejected", "Support inbound ticket rejected");
    if (!runtime.ingestSupportInbound) return postgresRequired(reply);
    const result = await runtime.ingestSupportInbound({
      context: createEnterpriseTenantContext({
        tenantId: verified.payload.tenantId,
        actorUserId: "service:support_ingress",
        traceId: enterpriseRequestTraceId(request),
      }), route: verified.payload, event: body.event,
    });
    if (result.status === "created" || result.status === "replayed") {
      const communicationSessionId =
        result.aggregate.communicationBinding?.communicationSessionId;
      if (!communicationSessionId) return notReady(reply, "binding_not_ready");
      return reply.status(result.status === "created" ? 201 : 200).send({
        status: result.status, sessionId: result.aggregate.session.id,
        communicationSessionId,
      });
    }
    return runtimeFailure(reply, result.status);
  });
}

function channelRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, [
    "id", "channelType", "provider", "configRef", "status",
  ]) || !uuid(body.id) || !channelType(body.channelType) ||
    !provider(body.provider) || !configRef(body.configRef) ||
    !["inactive", "active"].includes(String(body.status))) return null;
  return { id: body.id, channelType: body.channelType, provider: body.provider,
    configRef: body.configRef, status: body.status as "inactive" | "active" };
}
function authorizationRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "channelId", "channelType"]) ||
    !uuid(body.tenantId) || !uuid(body.channelId) || !channelType(body.channelType)) {
    return null;
  }
  return { tenantId: body.tenantId, channelId: body.channelId,
    channelType: body.channelType };
}
function inboundRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["ticket", "event"]) ||
    !bounded(body.ticket, 4_096)) return null;
  const event = parseEvent(body.event);
  return event ? { ticket: body.ticket, event } : null;
}
function parseEvent(value: unknown): EnterpriseSupportInboundEvent | null {
  const body = object(value);
  if (!body || !exactOptional(body,
    ["source", "sourceEventId", "customerKeyHash", "priority", "occurredAt"],
    ["phoneHash", "displayName", "locale", "intent"]) ||
    !provider(body.source) || !eventKey(body.sourceEventId) ||
    !hash(body.customerKeyHash) || (body.phoneHash !== undefined && !hash(body.phoneHash)) ||
    !Number.isSafeInteger(body.priority) || Number(body.priority) < 0 ||
    Number(body.priority) > 100 || !iso(body.occurredAt) ||
    !optionalBounded(body.displayName, 120) || !optionalBounded(body.intent, 200) ||
    (body.locale !== undefined && (typeof body.locale !== "string" ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(body.locale)))) return null;
  return body as unknown as EnterpriseSupportInboundEvent;
}
async function channelReady(
  service: EnterpriseProviderReadinessService, region: string,
  type: "pstn" | "web" | "app", providerName: string,
) {
  if (type !== "pstn" && providerName === "first_party") return true;
  const capabilityName = type === "pstn" ? "pstn.outbound" : "channel.messaging";
  const capability = (await service.getCapabilities({ region }))
    .find((item) => item.capability === capabilityName);
  return Boolean(capability && capability.status === "ready" &&
    capability.features.inbound === true && Date.parse(capability.expiresAt) > Date.now());
}
function internalAuthorized(request: FastifyRequest) {
  const expected = Buffer.from(process.env.INTERNAL_API_SECRET?.trim() ?? "");
  const authorization = request.headers.authorization;
  const supplied = Buffer.from(authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function runtimeFailure(reply: FastifyReply, status: string) {
  if (status === "channel_not_found") return sendError(reply, 404,
    status, "Support channel not found");
  if (status === "event_conflict") return sendError(reply, 409,
    status, "Support inbound event conflicts with its first payload");
  return notReady(reply, status);
}
function object(value: unknown) { return value && typeof value === "object" &&
  !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === keys.sort().join(","); }
function exactOptional(value: Record<string, unknown>, required: string[], optional: string[]) {
  const keys = Object.keys(value); return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key)); }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function channelType(value: unknown): value is "pstn" | "web" | "app" {
  return value === "pstn" || value === "web" || value === "app"; }
function provider(value: unknown): value is string { return typeof value === "string" &&
  /^[a-z][a-z0-9_-]{1,63}$/.test(value); }
function configRef(value: unknown): value is string { return typeof value === "string" &&
  /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(value); }
function bounded(value: unknown, max: number): value is string { return typeof value === "string" &&
  value.trim().length > 0 && Buffer.byteLength(value.trim()) <= max; }
function optionalBounded(value: unknown, max: number) { return value === undefined || bounded(value, max); }
function eventKey(value: unknown): value is string { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function iso(value: unknown): value is string { if (typeof value !== "string") return false;
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401,
  "internal_error", "Unauthorized internal request"); }
function invalid(reply: FastifyReply, code: string) { return sendError(reply, 400, code, "Invalid support channel request"); }
function notReady(reply: FastifyReply, reason: string) { return sendError(reply, 503,
  "support_channel_not_ready", `Support channel not ready: ${reason}`); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
