import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import {
  enterpriseExecutionPreferences,
  enterpriseSensitiveFeatureModes,
  type EnterpriseExecutionPreference,
  type EnterpriseSensitiveFeatureMode,
} from "./enterprise-communication-policy.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";
import {
  requireTenantRouteDocument,
} from "./enterprise-tenant-route.routes.js";
import type {
  TenantRouteService,
} from "./enterprise-tenant-route.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

export async function registerEnterpriseCommunicationPolicyRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/enterprise/v1/communication-policies", async (request, reply) => {
    const access = await requireEnterpriseScope(
      request,
      reply,
      runtime,
      "tenant:write",
      {
        action: "communication_policy.publish",
        resourceType: "communication_policy",
      },
    );
    if (!access) return;
    if (!requireTenantRouteDocument(
      request,
      reply,
      routeService,
      access.tenant,
    )) return;
    if (!runtime.publishCommunicationPolicy) {
      return sendError(
        reply,
        503,
        "enterprise_postgres_required",
        "PostgreSQL enterprise runtime required",
      );
    }
    const raw = request.body as PolicyBody | undefined;
    if (raw?.tenantId !== undefined && raw.tenantId !== access.tenant.id) {
      return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
    }
    const parsed = parsePolicy(request.body);
    if (!parsed) {
      return sendError(reply, 400, "invalid_communication_policy", "Invalid policy");
    }
    const publishedAt = new Date().toISOString();
    const id = randomUUID();
    const result = await runtime.publishCommunicationPolicy({
      context: createEnterpriseTenantContext({
        tenantId: access.tenant.id,
        actorUserId: access.account.id,
        actorRole: access.member.role,
        traceId: enterpriseRequestTraceId(request),
      }),
      policy: { id, ...parsed, publishedAt },
    });
    if (result.status === "storage_required") {
      return sendError(
        reply,
        503,
        "enterprise_postgres_required",
        "PostgreSQL enterprise runtime required",
      );
    }
    if (result.status === "version_conflict") {
      return sendError(reply, 409, "policy_version_conflict", "Policy version exists");
    }
    return reply.status(201).send({
      policy: { id: result.id, policyVersion: parsed.policyVersion,
        status: "published", publishedAt },
    });
  });
}

interface PolicyBody {
  tenantId?: unknown;
  policyVersion?: unknown;
  asrPreference?: unknown;
  translationPreference?: unknown;
  ttsPreference?: unknown;
  voiceIdentityMode?: unknown;
  recordingMode?: unknown;
  diagnosticAudioMode?: unknown;
  allowCaptionsOnly?: unknown;
  allowHalfDuplex?: unknown;
}

function parsePolicy(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as PolicyBody;
  const policyVersion = bounded(body.policyVersion, 128);
  const asrPreference = preference(body.asrPreference);
  const translationPreference = preference(body.translationPreference);
  const ttsPreference = preference(body.ttsPreference);
  const voiceIdentityMode = sensitiveMode(body.voiceIdentityMode);
  const recordingMode = sensitiveMode(body.recordingMode);
  const diagnosticAudioMode = sensitiveMode(body.diagnosticAudioMode);
  if (!policyVersion || !asrPreference || !translationPreference ||
    !ttsPreference || !voiceIdentityMode || !recordingMode ||
    !diagnosticAudioMode || typeof body.allowCaptionsOnly !== "boolean" ||
    typeof body.allowHalfDuplex !== "boolean") return null;
  return {
    policyVersion,
    asrPreference,
    translationPreference,
    ttsPreference,
    voiceIdentityMode,
    recordingMode,
    diagnosticAudioMode,
    allowCaptionsOnly: body.allowCaptionsOnly,
    allowHalfDuplex: body.allowHalfDuplex,
  };
}

function preference(value: unknown): EnterpriseExecutionPreference | null {
  return enterpriseExecutionPreferences.includes(
    value as EnterpriseExecutionPreference,
  ) ? value as EnterpriseExecutionPreference : null;
}
function sensitiveMode(value: unknown): EnterpriseSensitiveFeatureMode | null {
  return enterpriseSensitiveFeatureModes.includes(
    value as EnterpriseSensitiveFeatureMode,
  ) ? value as EnterpriseSensitiveFeatureMode : null;
}
function bounded(value: unknown, max: number) {
  return typeof value === "string" && value.trim() &&
      Buffer.byteLength(value) <= max
    ? value.trim()
    : null;
}
