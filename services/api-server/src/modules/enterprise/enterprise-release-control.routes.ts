import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseReleaseControlDto } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import {
  isEnterpriseReleaseCapability,
  type EnterpriseReleaseControlAction,
  type EnterpriseReleaseOutcome,
} from "./enterprise-release-control.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseReleaseControlRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/release-controls", async (request, reply) => {
    const access = await requireEnterpriseScope(
      request, reply, runtime, "tenant:read",
      { action: "release_control.read", resourceType: "release_control" },
    );
    if (!access || !requireTenantRouteDocument(
      request, reply, routeService, access.tenant,
    )) return;
    if (!runtime.listReleaseControls) return postgresRequired(reply);
    const result = await runtime.listReleaseControls({
      context: createEnterpriseTenantContext({
        tenantId: access.tenant.id, actorUserId: access.account.id,
        actorRole: access.member.role, traceId: enterpriseRequestTraceId(request),
      }),
    });
    if (result.status !== "ready") return postgresRequired(reply);
    return reply.send({ defaultDecision: "deny",
      controls: result.controls.map(controlDto) });
  });

  app.post<{ Body: unknown }>(
    "/internal/enterprise/release-controls/change",
    async (request, reply) => {
      const actorId = internalActor(request);
      if (!actorId) return unauthorized(reply);
      const body = changeBody(request.body, new Date());
      if (!body) return invalid(reply);
      if (!runtime.changeReleaseControl) return postgresRequired(reply);
      const result = await runtime.changeReleaseControl({ ...body, actorId,
        traceId: enterpriseRequestTraceId(request), now: new Date().toISOString() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "conflict" || result.status === "invalid_transition") {
        return sendError(reply, 409, `release_control_${result.status}`,
          "Release control change rejected");
      }
      if (result.status === "already_recorded") return reply.send(result);
      if (result.status !== "updated") return postgresRequired(reply);
      return reply.send({ status: "updated", control: controlDto(result.control) });
    },
  );

  app.post<{ Body: unknown }>(
    "/internal/enterprise/release-controls/outcomes",
    async (request, reply) => {
      const actorId = internalActor(request);
      if (!actorId) return unauthorized(reply);
      const body = outcomeBody(request.body);
      if (!body) return invalid(reply);
      if (body.probe && !probeAuthorized(request)) return unauthorized(reply);
      if (!runtime.recordReleaseOutcome) return postgresRequired(reply);
      const result = await runtime.recordReleaseOutcome({ ...body, actorId,
        traceId: enterpriseRequestTraceId(request), now: new Date().toISOString() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return sendError(reply, 404,
        "release_control_not_found", "Release control not found");
      if (result.status === "invalid_state") return sendError(reply, 409,
        "release_control_invalid_state", "Release outcome rejected");
      if (result.status === "already_recorded") return reply.send(result);
      if (result.status === "unchanged") {
        return reply.send({ status: "unchanged", control: controlDto(result.control) });
      }
      if (result.status !== "updated") return postgresRequired(reply);
      return reply.send({ status: "updated", control: controlDto(result.control) });
    },
  );

  app.post<{ Body: unknown }>(
    "/internal/enterprise/release-controls/decision",
    async (request, reply) => {
      const actorId = internalActor(request);
      if (!actorId) return unauthorized(reply);
      const body = decisionBody(request.body);
      if (!body) return invalid(reply);
      if (body.probe && !probeAuthorized(request)) return unauthorized(reply);
      if (!runtime.evaluateReleaseControl) return postgresRequired(reply);
      const result = await runtime.evaluateReleaseControl({ ...body,
        context: createEnterpriseTenantContext({ tenantId: body.tenantId,
          actorUserId: actorId, traceId: enterpriseRequestTraceId(request) }),
        now: new Date().toISOString() });
      if (result.status !== "ready") return postgresRequired(reply);
      return reply.send({ decision: result.decision });
    },
  );

  app.post<{ Body: unknown }>(
    "/internal/enterprise/release-controls/status",
    async (request, reply) => {
      const actorId = internalActor(request);
      if (!actorId) return unauthorized(reply);
      const body = statusBody(request.body);
      if (!body) return invalid(reply);
      if (!runtime.listReleaseControls) return postgresRequired(reply);
      const result = await runtime.listReleaseControls({
        context: createEnterpriseTenantContext({ tenantId: body.tenantId,
          actorUserId: actorId, traceId: enterpriseRequestTraceId(request) }),
      });
      if (result.status !== "ready") return postgresRequired(reply);
      const control = result.controls.find(
        ({ capability }) => capability === body.capability,
      );
      return control ? reply.send({ status: "ready", control: controlDto(control) })
        : reply.send({ status: "not_configured", defaultDecision: "deny" });
    },
  );
}

function changeBody(value: unknown, now: Date) {
  const body = object(value);
  if (!body) return null;
  const common = ["tenantId", "capability", "expectedVersion", "action",
    "owner", "rolloutExpiresAt", "failureThreshold", "reason", "operationId"];
  const action = actionValue(body);
  const extra = body.action === "set_rollout" ? ["enabled"] :
    body.action === "set_kill_switch" ? ["active"] : [];
  if (!action || !exactKeys(body, [...common, ...extra])) return null;
  const tenantId = uuid(body.tenantId); const operationId = uuid(body.operationId);
  const capability = isEnterpriseReleaseCapability(body.capability)
    ? body.capability : null;
  const expectedVersion = integer(body.expectedVersion, 0, 1_000_000_000);
  const failureThreshold = integer(body.failureThreshold, 1, 100);
  const owner = code(body.owner, 128); const reason = sentence(body.reason, 500);
  const rolloutExpiresAt = futureIso(body.rolloutExpiresAt, now, 180);
  return tenantId && operationId && capability && expectedVersion !== null &&
      failureThreshold && owner && reason && rolloutExpiresAt
    ? { tenantId, operationId, capability, expectedVersion, action, owner,
      reason, failureThreshold, rolloutExpiresAt } : null;
}

function outcomeBody(value: unknown) {
  const body = object(value);
  if (!body || !exactKeys(body,
    ["tenantId", "capability", "outcome", "probe", "operationId"])) return null;
  const tenantId = uuid(body.tenantId); const operationId = uuid(body.operationId);
  const capability = isEnterpriseReleaseCapability(body.capability)
    ? body.capability : null;
  const outcome: EnterpriseReleaseOutcome["outcome"] | null =
    body.outcome === "success" || body.outcome === "failure"
    ? body.outcome : null;
  return tenantId && operationId && capability && outcome &&
      typeof body.probe === "boolean"
    ? { tenantId, operationId, capability, outcome, probe: body.probe } : null;
}

function decisionBody(value: unknown) {
  const body = object(value);
  if (!body || !exactKeys(body, ["tenantId", "capability", "probe"])) return null;
  const tenantId = uuid(body.tenantId);
  const capability = isEnterpriseReleaseCapability(body.capability)
    ? body.capability : null;
  return tenantId && capability && typeof body.probe === "boolean"
    ? { tenantId, capability, probe: body.probe } : null;
}

function statusBody(value: unknown) {
  const body = object(value);
  if (!body || !exactKeys(body, ["tenantId", "capability"])) return null;
  const tenantId = uuid(body.tenantId);
  const capability = isEnterpriseReleaseCapability(body.capability)
    ? body.capability : null;
  return tenantId && capability ? { tenantId, capability } : null;
}

function actionValue(body: Record<string, unknown>): EnterpriseReleaseControlAction | null {
  if (body.action === "set_rollout" && typeof body.enabled === "boolean") {
    return { type: "set_rollout", enabled: body.enabled };
  }
  if (body.action === "set_kill_switch" && typeof body.active === "boolean") {
    return { type: "set_kill_switch", active: body.active };
  }
  return body.action === "begin_probe" ? { type: "begin_probe" } : null;
}

function internalActor(request: FastifyRequest) {
  if (!secretAuthorized(request.headers.authorization,
    process.env.ENTERPRISE_RELEASE_CONTROL_INTERNAL_KEY)) return null;
  const value = single(request.headers["x-enterprise-operator-id"]);
  return code(value, 160);
}
function probeAuthorized(request: FastifyRequest) {
  const internalKey = process.env.ENTERPRISE_RELEASE_CONTROL_INTERNAL_KEY?.trim();
  const probeKey = process.env.ENTERPRISE_RELEASE_PROBE_KEY?.trim();
  if (!internalKey || !probeKey || internalKey === probeKey) return false;
  return secretAuthorized(single(request.headers["x-enterprise-release-probe-key"]),
    probeKey, "");
}
function secretAuthorized(header: string | undefined, secret: string | undefined,
  prefix = "Bearer ") {
  const expected = Buffer.from(secret?.trim() ?? "");
  const supplied = Buffer.from(header?.startsWith(prefix) ? header.slice(prefix.length) : "");
  return expected.length >= 32 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function controlDto(control: EnterpriseReleaseControlDto) {
  const { capability, enabled, killSwitchActive, circuitState,
    consecutiveFailures, failureThreshold, owner, rolloutExpiresAt,
    version, updatedAt } = control;
  return { capability, enabled, killSwitchActive, circuitState,
    consecutiveFailures, failureThreshold, owner, rolloutExpiresAt,
    version, updatedAt };
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function exactKeys(value: Record<string, unknown>, keys: string[]) { return (
  Object.keys(value).sort().join(",") === [...keys].sort().join(",")); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function integer(value: unknown, min: number, max: number) { return typeof value ===
  "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null; }
function code(value: unknown, max: number) { return typeof value === "string" &&
  value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value) ? value : null; }
function sentence(value: unknown, max: number) { return typeof value === "string" &&
  value.trim().length >= 8 && value.trim().length <= max ? value.trim() : null; }
function futureIso(value: unknown, now: Date, maxDays: number) { if (typeof value !==
  "string") return null; const parsed = Date.parse(value); return Number.isFinite(parsed) &&
  parsed > now.getTime() && parsed <= now.getTime() + maxDays * 86_400_000
    ? new Date(parsed).toISOString() : null; }
function single(value: string | string[] | undefined) { return Array.isArray(value)
  ? value[0] : value; }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401,
  "internal_error", "Unauthorized internal request"); }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_release_control_request", "Invalid release control request"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
