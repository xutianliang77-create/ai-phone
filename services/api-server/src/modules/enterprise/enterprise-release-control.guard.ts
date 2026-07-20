import type { FastifyReply } from "fastify";
import type { EnterpriseReleaseCapability } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

export async function requireEnterpriseReleaseCapability(
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  context: EnterpriseTenantContext,
  capability: EnterpriseReleaseCapability,
  probe = false,
) {
  if (!runtime.evaluateReleaseControl) {
    sendError(reply, 503, "enterprise_postgres_required",
      "Enterprise PostgreSQL runtime required");
    return null;
  }
  const result = await runtime.evaluateReleaseControl({
    context, capability, probe, now: new Date().toISOString(),
  });
  if (result.status !== "ready") {
    sendError(reply, 503, "enterprise_postgres_required",
      "Enterprise PostgreSQL runtime required");
    return null;
  }
  if (!result.decision.allowed) {
    sendError(reply, 503, `enterprise_release_${result.decision.reason}`,
      "Enterprise capability is unavailable");
    return null;
  }
  return result.decision;
}

export async function recordEnterpriseReleaseOutcome(input: {
  runtime: EnterpriseRepositoryRuntime;
  context: EnterpriseTenantContext;
  capability: EnterpriseReleaseCapability;
  operationId: string;
  outcome: "success" | "failure";
  actorId: string;
}) {
  if (!input.runtime.recordReleaseOutcome) return false;
  const result = await input.runtime.recordReleaseOutcome({
    tenantId: input.context.tenantId,
    capability: input.capability,
    operationId: input.operationId,
    outcome: input.outcome,
    probe: false,
    actorId: input.actorId,
    traceId: input.context.traceId,
    now: new Date().toISOString(),
  });
  return result.status === "updated" || result.status === "unchanged" ||
    result.status === "already_recorded";
}
