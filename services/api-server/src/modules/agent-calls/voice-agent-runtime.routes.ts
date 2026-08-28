import type { FastifyInstance } from "fastify";
import type {
  AgentStepDecisionType,
  VoiceAgentRuntimeEventRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { registerCallLeg } from "../call-links/call-links.service.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import {
  findAgentCallDraftById,
  markAgentCallTakeoverReady,
} from "./agent-calls-runtime.repository.js";
import { recordAgentCallRuntimeResult } from
  "./agent-call-runtime-result-runtime.repository.js";
import { failAgentCallRuntime } from "./agent-call-webhook-runtime.js";
import { isInternalAuthorized } from "./agent-call-route-helpers.js";
import {
  appendAgentStep,
  expireAgentHandoff,
  hasAgentAmdCategory,
  hasAgentRuntimeEvent,
  findAgentStepByIdempotency,
  findRequestedAgentHandoff,
  updateAgentRun,
} from "./agent-orchestration-runtime.repository.js";
import {
  resolveVoiceAgentRuntimeBinding,
  resolveVoiceAgentRuntimeCallBinding,
} from
  "./voice-agent-runtime-binding.js";
import { executeVoiceAgentPhoneHangup } from
  "./voice-agent-phone-control.js";
import { resolveVoiceAgentPhoneSnapshotBinding } from
  "./voice-agent-phone-snapshot-binding.js";
import { voiceAgentRecordingConsentSnapshot } from
  "./voice-agent-recording-consent.js";
import { resolveVoiceAgentRuntimeCommand } from
  "./voice-agent-runtime-command.js";
import {
  applyVoiceAgentRecordingConsent,
} from "./voice-agent-recording-consent-event.js";
import {
  parseVoiceAgentRuntimeEvent,
  parseVoiceAgentRuntimeSnapshotRequest,
} from "./voice-agent-runtime-request.js";

export function registerVoiceAgentRuntimeRoutes(app: FastifyInstance) {
  app.post(
    "/internal/voice-agent/calls/:callId/runtime-snapshot",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentRuntimeSnapshotRequest(request.body);
      if (!body) {
        return sendError(reply, 400, "invalid_voice_agent_snapshot", "Invalid snapshot");
      }
      const binding = await resolveVoiceAgentRuntimeCallBinding(
        (request.params as { callId: string }).callId,
        body.ticket,
      );
      if (!binding.ok) return bindingError(reply, binding.code);
      const phone = await resolveVoiceAgentPhoneSnapshotBinding({
        call: binding.call,
        providerOperationId: binding.draft.providerOperationId!,
      });
      if (!phone.ok) {
        return sendError(
          reply,
          phone.statusCode,
          `voice_agent_phone_${phone.code}`,
          "Voice Agent phone binding is unavailable",
        );
      }
      const recordingConsent = binding.draft.recordingRequested
        ? voiceAgentRecordingConsentSnapshot({
            language: binding.draft.language,
            callExpiresAt: binding.call.expiresAt,
          })
        : null;
      if (binding.draft.recordingRequested &&
        (!recordingConsent || recordingConsent.policyVersion !==
          binding.draft.recordingPolicyVersion)) {
        return sendError(
          reply,
          409,
          "voice_agent_recording_policy_conflict",
          "Voice Agent recording policy binding failed",
        );
      }
      await registerCallLeg({
        callId: binding.call.callId,
        participantIdentity: body.participantIdentity,
        participantRole: "worker",
        joinType: "worker",
      });
      binding.runtime.heartbeat?.(binding.call.callId, {
        generation: binding.claim.generation,
        workerId: body.workerId,
        jobId: body.jobId,
      });
      return {
        draftId: binding.draft.id,
        callId: binding.call.callId,
        sessionId: binding.call.sessionId,
        roomName: binding.call.roomName,
        participantIdentity: body.participantIdentity,
        telephonyProvider: phone.operation.provider,
        calleeParticipantIdentity: phone.binding.participantIdentity,
        ...(phone.binding.deviceLease ? {
          airDeviceBinding: {
            deviceId: phone.binding.deviceLease.deviceId,
            leaseId: phone.binding.deviceLease.leaseId,
            callGeneration: phone.binding.callGeneration,
          },
        } : {}),
        ...(phone.operation.provider === "livekit_sip"
          ? { sipParticipantIdentity: phone.binding.participantIdentity }
          : {}),
        generation: binding.claim.generation,
        run: binding.run,
        mode: "autonomous",
        scenario: binding.draft.scenario,
        language: binding.draft.language,
        objective: binding.draft.objective,
        approvedScript: binding.draft.suggestedScript,
        disclosureText: disclosureText(binding.draft.language),
        disclosurePromptVersion: binding.draft.disclosurePromptVersion,
        ...(recordingConsent ? { recordingConsent } : {}),
      };
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/runtime-events",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentRuntimeEvent(request.body);
      if (!body) {
        return sendError(reply, 400, "invalid_voice_agent_event", "Invalid runtime event");
      }
      const binding = await resolveVoiceAgentRuntimeBinding(
        (request.params as { draftId: string }).draftId,
        body.ticket,
      );
      if (!binding.ok) return bindingError(reply, binding.code);
      const runtimeClaim = {
        generation: binding.claim.generation,
        ...(body.workerId ? { workerId: body.workerId } : {}),
        ...(body.jobId ? { jobId: body.jobId } : {}),
      };
      const existing = body.event === "heartbeat"
        ? null
        : await findAgentStepByIdempotency(binding.run.id, body.eventId);
      if (body.event === "structured_result" &&
        !await hasAgentRuntimeEvent(binding.run.id, "disclosure_completed") &&
        !await hasAgentAmdCategory(binding.run.id, [
          "machine-ivr",
          "machine-vm",
          "machine-unavailable",
        ])) {
        return sendError(
          reply,
          409,
          "voice_agent_disclosure_incomplete",
          "Disclosure or machine classification is required",
        );
      }
      if (body.event === "recording_consent" &&
        !await hasAgentRuntimeEvent(binding.run.id, "disclosure_completed")) {
        return sendError(
          reply,
          409,
          "voice_agent_disclosure_incomplete",
          "Disclosure is required before recording consent",
        );
      }
      if (!existing && body.event === "recording_consent" && body.recordingConsent) {
        const consent = await applyVoiceAgentRecordingConsent({
          call: binding.call,
          draft: binding.draft,
          generation: binding.claim.generation,
          eventId: body.eventId,
          consent: body.recordingConsent,
        });
        if (!consent.ok) {
          return sendError(
            reply,
            409,
            `voice_agent_recording_${consent.code}`,
            "Recording consent binding failed",
          );
        }
        if (consent.stop.failed > 0) {
          request.log.error({
            callId: binding.call.callId,
            failedStops: consent.stop.failed,
          }, "Recording consent revocation requires reconciliation");
        }
      }
      if (!existing) {
        await withSessionWriteLock(binding.call.sessionId, () =>
          applyRuntimeEvent(binding, body, runtimeClaim));
      }
      const handoffTimedOut = body.event === "heartbeat"
        ? await expireHandoffIfNeeded(binding)
        : false;
      const dispatch = await findWorkerDispatch(binding.call.sessionId);
      if (!dispatch || dispatch.generation !== binding.claim.generation) {
        return sendError(reply, 409, "voice_agent_generation_conflict", "Dispatch is stale");
      }
      const currentDraft = await findAgentCallDraftById(binding.draft.id);
      if (!currentDraft) {
        return sendError(reply, 409, "voice_agent_binding_missing", "Draft is unavailable");
      }
      return {
        callId: binding.call.callId,
        generation: dispatch.generation,
        dispatchStatus: dispatch.status,
        command: resolveVoiceAgentRuntimeCommand({
          draft: currentDraft,
          handoffTimedOut,
        }),
        leaseExpiresAt: dispatch.leaseExpiresAt,
        replayed: existing !== null,
      };
    },
  );
}

async function expireHandoffIfNeeded(
  binding: Extract<
    Awaited<ReturnType<typeof resolveVoiceAgentRuntimeBinding>>,
    { ok: true }
  >,
) {
  if (binding.draft.status !== "takeover_requested") return false;
  const handoff = await findRequestedAgentHandoff(binding.run.id, "user");
  if (!handoff || Date.now() - Date.parse(handoff.requestedAt) <
      handoffTimeoutSeconds() * 1000) return false;
  const result = await withSessionWriteLock(binding.call.sessionId, () =>
    executeVoiceAgentPhoneHangup({
      call: binding.call,
      providerOperationId: binding.draft.providerOperationId!,
      idempotencyKey: `voice-agent-handoff-timeout:${binding.call.sessionId}`,
    }));
  if (!result.ok) return false;
  await expireAgentHandoff(binding.run.id);
  await recordAgentCallRuntimeResult(binding.draft.id, {
    outcome: "unresolved",
    summary: "人工接管等待超时，系统已安全结束电话。",
    evidence: ["handoff_timeout"],
    unresolvedItems: [binding.draft.objective],
    nextStep: "确认人工可接管后再重新发起任务。",
  });
  return true;
}

function handoffTimeoutSeconds() {
  const value = Number(process.env.VOICE_AGENT_HANDOFF_TIMEOUT_SECONDS ?? 120);
  return Number.isInteger(value) && value >= 30 && value <= 600 ? value : 120;
}

async function applyRuntimeEvent(
  binding: Extract<
    Awaited<ReturnType<typeof resolveVoiceAgentRuntimeBinding>>,
    { ok: true }
  >,
  body: VoiceAgentRuntimeEventRequest,
  runtimeClaim: { generation: number; workerId?: string; jobId?: string },
) {
  if (body.event === "ready") {
    await binding.runtime.markReady(binding.call.callId, runtimeClaim);
    await updateAgentRun({ runId: binding.run.id, status: "running" });
  } else if (body.event === "heartbeat") {
    await binding.runtime.heartbeat?.(binding.call.callId, runtimeClaim);
    return;
  } else if (body.event === "failed") {
    await binding.runtime.reportFailure?.(
      binding.call.callId,
      runtimeClaim,
      body.errorClass ?? "voice_agent_failed",
    );
    await updateAgentRun({
      runId: binding.run.id,
      status: "failed",
      failureCode: body.errorClass ?? "voice_agent_failed",
    });
    await failAgentCallRuntime(
      binding.draft.id,
      body.errorClass ?? "voice_agent_failed",
    );
  } else if (body.event === "ending") {
    await binding.runtime.stop(binding.call.callId);
  } else if (body.event === "takeover_ready") {
    await markAgentCallTakeoverReady(binding.draft.id);
  } else if (body.event === "structured_result" && body.result) {
    await recordAgentCallRuntimeResult(binding.draft.id, body.result);
  }
  await appendAgentStep({
    runId: binding.run.id,
    decisionType: decisionType(body.event),
    outputSummary: JSON.stringify(eventSummary(body)),
    idempotencyKey: body.eventId,
    status: "executed",
  });
}

function decisionType(event: VoiceAgentRuntimeEventRequest["event"]): AgentStepDecisionType {
  if (event.startsWith("disclosure_")) return "disclosure";
  if (event === "recording_consent") return "recording_consent";
  if (event === "amd_classified") return "amd_classification";
  if (event === "ivr_detected") return "ivr_navigation";
  if (event === "structured_result") return "structured_result";
  return "runtime_event";
}

function eventSummary(body: VoiceAgentRuntimeEventRequest) {
  return {
    event: body.event,
    ...(body.amdCategory ? { amdCategory: body.amdCategory } : {}),
    ...(body.transcriptSummary ? { transcriptSummary: body.transcriptSummary } : {}),
    ...(body.recordingConsent ? { recordingConsent: body.recordingConsent } : {}),
    ...(body.result ? { result: body.result } : {}),
    ...(body.errorClass ? { errorClass: body.errorClass } : {}),
  };
}

function disclosureText(language: "zh" | "en") {
  return language === "en"
    ? process.env.VOICE_AGENT_DISCLOSURE_TEXT_EN!
    : process.env.VOICE_AGENT_DISCLOSURE_TEXT_ZH!;
}

function bindingError(reply: Parameters<typeof sendError>[0], code: string) {
  return sendError(reply, 409, `voice_agent_${code}`, "Voice Agent binding failed");
}
