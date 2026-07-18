import type { FastifyReply } from "fastify";
import { enterpriseMeetingTranslationTopic } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { createEnterpriseMeetingRtcToken } from "./enterprise-meeting-rtc-token.js";
import type { EnterpriseMeetingJoinAuthorization } from
  "./enterprise-meeting-runtime.js";
import type { EnterpriseMeetingTranslationDispatchService } from
  "./enterprise-meeting-translation-dispatch.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export async function issueEnterpriseMeetingJoinToken(
  reply: FastifyReply,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  translationDispatch: EnterpriseMeetingTranslationDispatchService,
  tenantContext: ReturnType<typeof createEnterpriseTenantContext>,
  authorization: EnterpriseMeetingJoinAuthorization,
) {
  const route = routeService.issue({
    tenantId: tenantContext.tenantId,
    ...authorization.routing,
  });
  if (route.status === "not_ready") return joinTokenFailure(
    reply, runtime, tenantContext, authorization, "route_not_ready",
  );
  const translationBase = meetingTranslationBase(authorization);
  const result = await createEnterpriseMeetingRtcToken({
    tenantId: tenantContext.tenantId,
    meetingId: authorization.aggregate.meeting.id,
    communicationSessionId: authorization.binding.communicationSessionId,
    communicationStatus: authorization.binding.status,
    participantId: authorization.participant.id,
    participantRole: authorization.participant.role,
    participantName: authorization.participant.displayName,
    rtcUrl: route.document.rtcUrl,
    translation: {
      ...translationBase,
      status: "not_ready",
      reasonCode: "translation_runtime_not_prepared",
    },
  });
  if (result.status === "not_ready") return joinTokenFailure(
    reply, runtime, tenantContext, authorization, result.reason,
  );
  const translation = await prepareTranslation(
    runtime, translationDispatch, tenantContext, authorization,
  );
  result.token.translation = translation;
  await runtime.appendAudit({
    context: tenantContext,
    action: "meeting.join_token",
    resourceType: "meeting",
    resourceId: authorization.aggregate.meeting.id,
    result: "completed",
    details: {
      participantId: authorization.participant.id,
      role: authorization.participant.role,
      communicationStatus: authorization.binding.status,
      translationStatus: translation.status,
      translationReasonCode: translation.reasonCode,
    },
  });
  return reply.send(result.token);
}

async function prepareTranslation(
  runtime: EnterpriseRepositoryRuntime,
  dispatchService: EnterpriseMeetingTranslationDispatchService,
  tenantContext: ReturnType<typeof createEnterpriseTenantContext>,
  authorization: EnterpriseMeetingJoinAuthorization,
) {
  const base = meetingTranslationBase(authorization);
  if (!runtime.prepareMeetingTranslation) {
    return { ...base, status: "not_ready" as const,
      reasonCode: "translation_runtime_not_configured" };
  }
  const prepared = await runtime.prepareMeetingTranslation({
    context: tenantContext,
    meetingId: authorization.aggregate.meeting.id,
    now: new Date().toISOString(),
  });
  if (prepared.status !== "ready") {
    return { ...base, status: "not_ready" as const,
      reasonCode: prepared.status === "not_ready"
        ? prepared.reasonCode : "translation_storage_required" };
  }
  const dispatched = await dispatchService.ensure(prepared.dispatch);
  if (dispatched.status !== "ready") {
    return { ...base, generation: prepared.dispatch.generation,
      status: "not_ready" as const, reasonCode: dispatched.reasonCode };
  }
  return {
    ...base,
    generation: prepared.dispatch.generation,
    status: prepared.dispatch.runtimeState === "full"
      ? "ready" as const : "captions_only" as const,
    reasonCode: prepared.dispatch.reasonCode,
  };
}

function meetingTranslationBase(authorization: EnterpriseMeetingJoinAuthorization) {
  return {
    topic: enterpriseMeetingTranslationTopic,
    generation: authorization.binding.generation,
    captionLanguage: authorization.participant.captionLanguage,
    translatedAudioEnabled: authorization.participant.translatedAudioEnabled,
    translatedAudioAvailable: false,
    playbackGeneration: authorization.participant.playbackGeneration,
  } as const;
}

async function joinTokenFailure(
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  tenantContext: ReturnType<typeof createEnterpriseTenantContext>,
  authorization: EnterpriseMeetingJoinAuthorization,
  reasonCode: string,
) {
  await runtime.appendAudit({
    context: tenantContext,
    action: "meeting.join_token",
    resourceType: "meeting",
    resourceId: authorization.aggregate.meeting.id,
    result: "failed",
    details: { participantId: authorization.participant.id, reasonCode },
  });
  return sendError(
    reply, 503, "meeting_not_ready", `Meeting not ready: ${reasonCode}`,
  );
}
