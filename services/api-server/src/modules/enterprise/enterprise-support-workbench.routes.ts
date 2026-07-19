import type { FastifyInstance, FastifyReply } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type { EnterpriseSupportWorkbenchSnapshot } from
  "./enterprise-support-workbench.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { registerEnterpriseSupportFollowupRoutes } from
  "./enterprise-support-followup.routes.js";

export function registerEnterpriseSupportWorkbenchRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  registerEnterpriseSupportFollowupRoutes(app, routeService, runtime);
  app.post<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/sessions/:sessionId/workbench",
    async (request, reply) => {
      const access = await authorized(
        request, reply, runtime, routeService, "support.workbench.activate",
      );
      if (!access) return;
      if (!uuid(request.params.sessionId) || !emptyBody(request.body)) {
        return invalid(reply);
      }
      if (!runtime.activateSupportWorkbench) return postgresRequired(reply);
      const result = await runtime.activateSupportWorkbench({
        context: context(access, request),
        sessionId: request.params.sessionId,
        now: new Date().toISOString(),
      });
      return result.status === "ready"
        ? reply.send(publicWorkbench(result.workbench, access.member.role))
        : failure(reply, result.status);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/sessions/:sessionId/workbench",
    async (request, reply) => {
      const access = await authorized(
        request, reply, runtime, routeService, "support.workbench.read",
      );
      if (!access) return;
      if (!uuid(request.params.sessionId)) return invalid(reply);
      if (!runtime.getSupportWorkbench) return postgresRequired(reply);
      const result = await runtime.getSupportWorkbench({
        context: context(access, request),
        sessionId: request.params.sessionId,
        now: new Date().toISOString(),
      });
      return result.status === "ready"
        ? reply.send(publicWorkbench(result.workbench, access.member.role))
        : failure(reply, result.status);
    },
  );
}

async function authorized(
  request: Parameters<typeof requireEnterpriseScope>[0],
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime,
    "support:takeover", { action, resourceType: "support_session" });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}

function context(
  access: NonNullable<Awaited<ReturnType<typeof authorized>>>,
  request: Parameters<typeof enterpriseRequestTraceId>[0],
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id,
    actorUserId: access.account.id,
    actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request),
  });
}

function publicWorkbench(
  workbench: EnterpriseSupportWorkbenchSnapshot,
  role: string,
) {
  const { aggregate } = workbench;
  return {
    generatedAt: workbench.generatedAt,
    session: {
      id: aggregate.session.id,
      status: aggregate.session.status,
      intent: aggregate.session.intent,
      priority: aggregate.session.priority,
      queueId: aggregate.session.queueId,
      assignedUserId: aggregate.session.assignedUserId,
      createdAt: aggregate.session.createdAt,
      queuedAt: aggregate.session.queuedAt,
      handoffRequestedAt: aggregate.session.handoffRequestedAt,
      assignedAt: aggregate.session.assignedAt,
      updatedAt: aggregate.session.updatedAt,
      version: aggregate.session.version,
    },
    claim: {
      id: workbench.claim.id,
      queueId: workbench.claim.queueId,
      agentUserId: workbench.claim.agentUserId,
      status: workbench.claim.status,
      claimedAt: workbench.claim.claimedAt,
      leaseExpiresAt: workbench.claim.leaseExpiresAt,
      updatedAt: workbench.claim.updatedAt,
      version: workbench.claim.version,
    },
    aiSpeechFence: workbench.aiSpeechFence,
    channel: {
      channelType: aggregate.channel.channelType,
      provider: aggregate.channel.provider,
      status: aggregate.channel.status,
    },
    customer: {
      id: aggregate.customer.id,
      externalId: aggregate.customer.externalId,
      displayName: aggregate.customer.displayName,
      locale: aggregate.customer.locale,
      attributes: maskedCustomerAttributes(aggregate.customer.attributes),
      consentScope: aggregate.customer.consentScope,
      updatedAt: aggregate.customer.updatedAt,
    },
    queue: aggregate.queue ? {
      id: aggregate.queue.id,
      name: aggregate.queue.name,
      status: aggregate.queue.status,
      handoffSlaSeconds: aggregate.queue.handoffSlaSeconds,
      claimLeaseSeconds: aggregate.queue.claimLeaseSeconds,
    } : undefined,
    communication: aggregate.communicationBinding ? {
      sessionId: aggregate.communicationBinding.communicationSessionId,
      status: aggregate.communicationBinding.status,
      generation: aggregate.communicationBinding.generation,
      updatedAt: aggregate.communicationBinding.updatedAt,
    } : undefined,
    cases: aggregate.cases.map((item) => ({
      id: item.id, subject: item.subject, status: item.status,
      summary: item.summary, resolution: item.resolution,
      externalTicketId: item.externalTicketId,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
    })),
    callbacks: aggregate.callbacks.map((item) => ({
      id: item.id, scheduledAt: item.scheduledAt, reason: item.reason,
      status: item.status, externalCallbackId: item.externalCallbackId,
      failureCode: item.failureCode, createdAt: item.createdAt,
      updatedAt: item.updatedAt, completedAt: item.completedAt,
    })),
    followups: aggregate.followups.map((item) => ({
      id: item.id, kind: item.kind, status: item.status,
      caseId: item.caseId, callbackId: item.callbackId,
      providerSimulated: item.providerSimulated, attempts: item.attempts,
      failureCode: item.failureCode, createdAt: item.createdAt,
      updatedAt: item.updatedAt, completedAt: item.completedAt,
    })),
    toolExecutions: aggregate.toolExecutions.map((item) => ({
      id: item.id, toolName: item.toolName, riskLevel: item.riskLevel,
      confirmationStatus: item.confirmationStatus, status: item.status,
      resultDocument: item.resultDocument, failureCode: item.failureCode,
      createdAt: item.createdAt, completedAt: item.completedAt,
      updatedAt: item.updatedAt,
    })),
    agent: workbench.agentRun ? {
      runId: workbench.agentRun.id,
      status: workbench.agentRun.status,
      locale: workbench.agentRun.locale,
      countryCode: workbench.agentRun.countryCode,
      productCode: workbench.agentRun.productCode,
      conversationState: workbench.agentRun.conversationState,
      generation: workbench.agentRun.generation,
      updatedAt: workbench.agentRun.updatedAt,
    } : undefined,
    conversationContext: workbench.conversationContext,
    agentTurns: workbench.agentTurns.flatMap((turn) => turn.output ? [{
      id: turn.id, sequence: turn.sequence, status: turn.status,
      spokenText: turn.output.spokenText, intent: turn.output.intent,
      riskSignals: turn.output.riskSignals,
      knowledgeCitations: turn.output.knowledgeCitations,
      createdAt: turn.createdAt, updatedAt: turn.updatedAt,
    }] : []),
    highRiskHandoffs: workbench.highRiskHandoffs.map((item) => ({
      id: item.id, toolName: item.toolName, riskCategory: item.riskCategory,
      policyVersion: item.policyVersion, createdAt: item.createdAt,
    })),
    transcriptSegments: workbench.transcriptSegments,
    controls: {
      renew: { status: "ready" },
      release: { status: "ready" },
      reassign: manager(role)
        ? { status: "ready" } : { status: "forbidden" },
      mute: notReady("livekit_agent_control_not_integrated"),
      transferQueue: notReady("support_queue_transfer_not_implemented"),
      endCall: notReady("livekit_agent_control_not_integrated"),
      createTicket: followupControl(workbench.followupReadiness),
      callback: followupControl(workbench.followupReadiness),
    },
  };
}

function failure(reply: FastifyReply, status: string) {
  if (status === "not_found") return sendError(reply, 404, status,
    "Support workbench not found");
  if (status === "forbidden") return sendError(reply, 403, status,
    "Support workbench access forbidden");
  if (status === "storage_required") return postgresRequired(reply);
  return sendError(reply, 409, status, "Support workbench is not available");
}
function emptyBody(value: unknown) {
  return value === undefined || Boolean(value && typeof value === "object" &&
    !Array.isArray(value) && Object.keys(value).length === 0);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function manager(role: string) {
  return role === "owner" || role === "admin" || role === "support_manager";
}
function notReady(reasonCode: string) {
  return { status: "not_ready", reasonCode } as const;
}
function followupControl(
  readiness: EnterpriseSupportWorkbenchSnapshot["followupReadiness"],
) {
  return readiness.status === "ready"
    ? { status: "ready", simulated: readiness.simulated } as const
    : notReady(readiness.reasonCode);
}
function maskedCustomerAttributes(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [
    name, sensitiveCustomerField(name) ? "[MASKED]" : maskedValue(item),
  ]));
}
function maskedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskedValue);
  if (value && typeof value === "object") {
    return maskedCustomerAttributes(value as Record<string, unknown>);
  }
  return value;
}
function sensitiveCustomerField(value: string) {
  return /(?:phone|mobile|email|address|identity|id_number|credential|token|secret|password)/i
    .test(value);
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_support_workbench_request",
    "Invalid Support workbench request");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
