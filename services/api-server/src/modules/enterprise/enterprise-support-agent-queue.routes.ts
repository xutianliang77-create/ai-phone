import type { FastifyInstance, FastifyReply } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type { EnterpriseSupportAgentClaimRecord } from
  "./enterprise-support-agent-queue.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseSupportAgentQueueRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/enterprise/v1/support/queues", async (request, reply) => {
    const access = await authorized(request, reply, runtime, routeService,
      "support:manage", "support.queue.create", "support_queue");
    if (!access) return;
    const body = queueRequest(request.body);
    if (!body) return invalid(reply);
    if (!runtime.createSupportQueue) return postgresRequired(reply);
    const result = await runtime.createSupportQueue({ context: context(access, request),
      queue: { ...body, createdBy: access.account.id,
        createdAt: new Date().toISOString() } });
    if (result.status === "created") {
      return reply.status(201).send({ queue: publicQueue(result.queue) });
    }
    if (result.status === "conflict") return failure(reply, result.status);
    return postgresRequired(reply);
  });

  app.get("/enterprise/v1/support/queues", async (request, reply) => {
    const access = await authorized(request, reply, runtime, routeService,
      "support:read", "support.queue.list", "support_queue");
    if (!access) return;
    if (!runtime.listSupportQueues) return postgresRequired(reply);
    const result = await runtime.listSupportQueues({ context: context(access, request) });
    return result.status === "ready"
      ? reply.send({ queues: result.queues.map(publicQueue) })
      : postgresRequired(reply);
  });

  app.get<{ Params: { queueId: string }; Querystring: { limit?: string } }>(
    "/enterprise/v1/support/queues/:queueId/work-items",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support:takeover", "support.queue.work_items.list", "support_queue");
      if (!access) return;
      const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
      if (!uuid(request.params.queueId) || !integer(limit, 1, 200)) return invalid(reply);
      if (!runtime.listSupportQueueWorkItems) return postgresRequired(reply);
      const result = await runtime.listSupportQueueWorkItems({
        context: context(access, request), queueId: request.params.queueId,
        limit, now: new Date().toISOString(),
      });
      return result.status === "ready" ? reply.send(result) : failure(reply, result.status);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/sessions/:sessionId/claims",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support:takeover", "support.claim.create", "support_session");
      if (!access) return;
      const body = claimRequest(request.body);
      if (!uuid(request.params.sessionId) || !body) return invalid(reply);
      if (!runtime.claimSupportSession) return postgresRequired(reply);
      const result = await runtime.claimSupportSession({
        context: context(access, request), sessionId: request.params.sessionId,
        ...body, now: new Date().toISOString(),
      });
      if (result.status === "claimed" || result.status === "replayed") {
        return reply.status(result.status === "claimed" ? 201 : 200).send({
          status: result.status, claim: publicClaim(result.claim),
          session: publicSession(result.session),
        });
      }
      return failure(reply, result.status);
    },
  );

  app.post<{ Params: { claimId: string } }>(
    "/enterprise/v1/support/claims/:claimId/renew",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support:takeover", "support.claim.renew", "support_agent_claim");
      if (!access) return;
      const body = versionRequest(request.body, "expectedClaimVersion");
      if (!uuid(request.params.claimId) || !body) return invalid(reply);
      if (!runtime.renewSupportAgentClaim) return postgresRequired(reply);
      const result = await runtime.renewSupportAgentClaim({
        context: context(access, request), claimId: request.params.claimId,
        expectedClaimVersion: body.expectedClaimVersion,
        now: new Date().toISOString(),
      });
      return result.status === "renewed"
        ? reply.send({ claim: publicClaim(result.claim) })
        : failure(reply, result.status);
    },
  );

  app.post<{ Params: { claimId: string } }>(
    "/enterprise/v1/support/claims/:claimId/release",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support:takeover", "support.claim.release", "support_agent_claim");
      if (!access) return;
      const body = releaseRequest(request.body);
      if (!uuid(request.params.claimId) || !body) return invalid(reply);
      if (!runtime.releaseSupportAgentClaim) return postgresRequired(reply);
      const result = await runtime.releaseSupportAgentClaim({
        context: context(access, request), claimId: request.params.claimId,
        ...body, now: new Date().toISOString(),
      });
      return result.status === "released" || result.status === "replayed"
        ? reply.send({ status: result.status, claim: publicClaim(result.claim),
            session: publicSession(result.session) })
        : failure(reply, result.status);
    },
  );

  app.post<{ Params: { claimId: string } }>(
    "/enterprise/v1/support/claims/:claimId/reassign",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support:takeover", "support.claim.reassign", "support_agent_claim");
      if (!access) return;
      if (!manager(access.member.role)) return failure(reply, "forbidden");
      const body = reassignRequest(request.body);
      if (!uuid(request.params.claimId) || !body) return invalid(reply);
      if (!runtime.reassignSupportAgentClaim) return postgresRequired(reply);
      const result = await runtime.reassignSupportAgentClaim({
        context: context(access, request), claimId: request.params.claimId,
        ...body, now: new Date().toISOString(),
      });
      return result.status === "reassigned" || result.status === "replayed"
        ? reply.send({ status: result.status,
            previousClaim: publicClaim(result.previousClaim),
            claim: publicClaim(result.claim), session: publicSession(result.session) })
        : failure(reply, result.status);
    },
  );
}

async function authorized(request: Parameters<typeof requireEnterpriseScope>[0],
  reply: FastifyReply, runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "support:read" | "support:manage" | "support:takeover",
  action: string, resourceType: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}
function context(access: NonNullable<Awaited<ReturnType<typeof authorized>>>,
  request: Parameters<typeof enterpriseRequestTraceId>[0]) {
  return createEnterpriseTenantContext({ tenantId: access.tenant.id,
    actorUserId: access.account.id, actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request) });
}
function queueRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["id", "name", "status", "defaultPriority",
    "handoffSlaSeconds", "claimLeaseSeconds"]) || !uuid(body.id) ||
    !text(body.name, 120) ||
    !["active", "paused", "disabled"].includes(String(body.status)) ||
    !integer(body.defaultPriority, 0, 100) ||
    !integer(body.handoffSlaSeconds, 10, 86_400) ||
    !integer(body.claimLeaseSeconds, 30, 3_600)) return null;
  return { id: body.id, name: body.name.trim(),
    status: body.status as "active" | "paused" | "disabled",
    defaultPriority: Number(body.defaultPriority),
    handoffSlaSeconds: Number(body.handoffSlaSeconds),
    claimLeaseSeconds: Number(body.claimLeaseSeconds) };
}
function claimRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["expectedSessionVersion", "idempotencyKey"]) ||
    !integer(body.expectedSessionVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !key(body.idempotencyKey)) return null;
  return { expectedSessionVersion: Number(body.expectedSessionVersion),
    idempotencyKey: body.idempotencyKey };
}
function releaseRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["expectedClaimVersion", "expectedSessionVersion",
    "idempotencyKey", "reason"]) ||
    !integer(body.expectedClaimVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(body.expectedSessionVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !key(body.idempotencyKey) ||
    !["agent_release", "agent_disconnect"].includes(String(body.reason))) return null;
  return { expectedClaimVersion: Number(body.expectedClaimVersion),
    expectedSessionVersion: Number(body.expectedSessionVersion),
    idempotencyKey: body.idempotencyKey,
    reason: body.reason as "agent_release" | "agent_disconnect" };
}
function reassignRequest(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["targetUserId", "expectedClaimVersion",
    "expectedSessionVersion", "idempotencyKey"]) || !subject(body.targetUserId) ||
    !integer(body.expectedClaimVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(body.expectedSessionVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !key(body.idempotencyKey)) return null;
  return { targetUserId: body.targetUserId,
    expectedClaimVersion: Number(body.expectedClaimVersion),
    expectedSessionVersion: Number(body.expectedSessionVersion),
    idempotencyKey: body.idempotencyKey };
}
function versionRequest(value: unknown, field: "expectedClaimVersion") {
  const body = object(value);
  return body && exact(body, [field]) &&
    integer(body[field], 1, Number.MAX_SAFE_INTEGER)
    ? { expectedClaimVersion: Number(body[field]) } : null;
}
function publicQueue(queue: { id: string; name: string; status: string;
  defaultPriority: number; handoffSlaSeconds: number; claimLeaseSeconds: number;
  createdAt: string; updatedAt: string; version: number }) {
  return { id: queue.id, name: queue.name, status: queue.status,
    defaultPriority: queue.defaultPriority,
    handoffSlaSeconds: queue.handoffSlaSeconds,
    claimLeaseSeconds: queue.claimLeaseSeconds,
    createdAt: queue.createdAt, updatedAt: queue.updatedAt,
    version: queue.version };
}
function publicClaim(claim: EnterpriseSupportAgentClaimRecord) {
  return { id: claim.id, supportSessionId: claim.supportSessionId,
    queueId: claim.queueId, agentUserId: claim.agentUserId, status: claim.status,
    ...(claim.reassignedFromClaimId
      ? { reassignedFromClaimId: claim.reassignedFromClaimId } : {}),
    claimedAt: claim.claimedAt, leaseExpiresAt: claim.leaseExpiresAt,
    ...(claim.releasedAt ? { releasedAt: claim.releasedAt } : {}),
    ...(claim.releasedBy ? { releasedBy: claim.releasedBy } : {}),
    ...(claim.releaseReason ? { releaseReason: claim.releaseReason } : {}),
    updatedAt: claim.updatedAt, version: claim.version };
}
function publicSession(session: { id: string; status: string; queueId?: string;
  assignedUserId?: string; activeAgentClaimId?: string; updatedAt: string;
  version: number }) {
  return { id: session.id, status: session.status,
    ...(session.queueId ? { queueId: session.queueId } : {}),
    ...(session.assignedUserId ? { assignedUserId: session.assignedUserId } : {}),
    ...(session.activeAgentClaimId
      ? { activeAgentClaimId: session.activeAgentClaimId } : {}),
    updatedAt: session.updatedAt, version: session.version };
}
function failure(reply: FastifyReply, status: string) {
  if (status === "not_found" || status === "queue_not_found") return sendError(reply,
    404, status, "Support queue resource not found");
  if (status === "forbidden") return sendError(reply, 403, status,
    "Support queue operation forbidden");
  if (status === "storage_required") return postgresRequired(reply);
  return sendError(reply, 409, status, "Support queue operation conflict");
}
function object(value: unknown) { return value && typeof value === "object" &&
  !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function subject(value: unknown): value is string { return typeof value === "string" &&
  /^user_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function key(value: unknown): value is string { return typeof value === "string" &&
  value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function text(value: unknown, max: number): value is string { return typeof value === "string" &&
  value.trim().length > 0 && Buffer.byteLength(value.trim()) <= max; }
function integer(value: unknown, min: number, max: number) {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }
function manager(role: string) {
  return role === "owner" || role === "admin" || role === "support_manager";
}
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_support_queue_request", "Invalid Support Agent queue request"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
