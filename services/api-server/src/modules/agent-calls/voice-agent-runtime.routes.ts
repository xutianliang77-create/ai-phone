import type { FastifyInstance } from "fastify";
import type {
  AgentStepDecisionType,
  VoiceAgentAmdCategory,
  VoiceAgentRuntimeEventRequest,
  VoiceAgentStructuredResultDto,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { registerCallLeg } from "../call-links/call-links.service.js";
import { liveKitSipParticipantIdentity } from
  "../call-links/livekit-sip-identity.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { getLiveKitSipConfig } from "../call-links/livekit-sip-readiness.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import {
  findAgentCallDraftById,
  markAgentCallTakeoverReady,
  recordAgentCallRuntimeResult,
} from "./agent-calls-runtime.repository.js";
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
import { executeVoiceAgentHangup } from "./voice-agent-sip-control.js";

export function registerVoiceAgentRuntimeRoutes(app: FastifyInstance) {
  app.post(
    "/internal/voice-agent/calls/:callId/runtime-snapshot",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseSnapshot(request.body);
      if (!body) {
        return sendError(reply, 400, "invalid_voice_agent_snapshot", "Invalid snapshot");
      }
      const binding = await resolveVoiceAgentRuntimeCallBinding(
        (request.params as { callId: string }).callId,
        body.ticket,
      );
      if (!binding.ok) return bindingError(reply, binding.code);
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
        sipParticipantIdentity: liveKitSipParticipantIdentity(
          binding.call.sessionId,
          binding.draft.providerOperationId!,
        ),
        generation: binding.claim.generation,
        run: binding.run,
        mode: "autonomous",
        scenario: binding.draft.scenario,
        language: binding.draft.language,
        objective: binding.draft.objective,
        approvedScript: binding.draft.suggestedScript,
        disclosureText: disclosureText(binding.draft.language),
        disclosurePromptVersion: binding.draft.disclosurePromptVersion,
      };
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/runtime-events",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseRuntimeEvent(request.body);
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
      if (!existing) {
        await applyRuntimeEvent(binding, body, runtimeClaim);
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
        command: handoffTimedOut
          ? "cancel"
          : currentDraft.status === "takeover_requested"
          ? "takeover"
          : currentDraft.status === "cancelled" ? "cancel" : "continue",
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
  const sip = getLiveKitSipConfig();
  if (!sip.ok) return false;
  const result = await withSessionWriteLock(binding.call.sessionId, () =>
    executeVoiceAgentHangup({
      call: binding.call,
      config: sip.config,
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

function parseSnapshot(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!bounded(value.ticket, 4096) || !bounded(value.participantIdentity, 256) ||
    !bounded(value.workerId, 128) || !bounded(value.jobId, 128)) return null;
  return {
    ticket: value.ticket,
    participantIdentity: value.participantIdentity,
    workerId: value.workerId,
    jobId: value.jobId,
  };
}

function parseRuntimeEvent(body: unknown): VoiceAgentRuntimeEventRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const events = [
    "ready", "heartbeat", "disclosure_started", "disclosure_completed",
    "amd_classified", "ivr_detected", "takeover_ready", "structured_result",
    "failed", "ending",
  ];
  if (!bounded(value.ticket, 4096) || !bounded(value.eventId, 128) ||
    !events.includes(String(value.event)) || !optional(value.workerId, 128) ||
    !optional(value.jobId, 128) || !optional(value.errorClass, 80) ||
    !optional(value.transcriptSummary, 500)) return null;
  const amdCategory = parseAmd(value.amdCategory);
  if (value.amdCategory !== undefined && !amdCategory) return null;
  const result = parseResult(value.result);
  if (value.event === "structured_result" && !result) return null;
  return {
    ticket: value.ticket,
    eventId: value.eventId,
    event: value.event as VoiceAgentRuntimeEventRequest["event"],
    ...(value.workerId ? { workerId: value.workerId as string } : {}),
    ...(value.jobId ? { jobId: value.jobId as string } : {}),
    ...(value.errorClass ? { errorClass: value.errorClass as string } : {}),
    ...(amdCategory ? { amdCategory } : {}),
    ...(value.transcriptSummary
      ? { transcriptSummary: value.transcriptSummary as string }
      : {}),
    ...(result ? { result } : {}),
  };
}

function parseResult(value: unknown): VoiceAgentStructuredResultDto | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!["completed", "partial", "unresolved", "failed"].includes(
    String(item.outcome),
  ) || !bounded(item.summary, 800)) return null;
  const evidence = strings(item.evidence, 8, 300);
  const unresolvedItems = strings(item.unresolvedItems, 8, 300);
  if (!evidence || !unresolvedItems || !optional(item.nextStep, 300)) return null;
  return {
    outcome: item.outcome as VoiceAgentStructuredResultDto["outcome"],
    summary: item.summary,
    evidence,
    unresolvedItems,
    ...(item.nextStep ? { nextStep: item.nextStep as string } : {}),
  };
}

function decisionType(event: VoiceAgentRuntimeEventRequest["event"]): AgentStepDecisionType {
  if (event.startsWith("disclosure_")) return "disclosure";
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
    ...(body.result ? { result: body.result } : {}),
    ...(body.errorClass ? { errorClass: body.errorClass } : {}),
  };
}

function disclosureText(language: "zh" | "en") {
  return language === "en"
    ? process.env.VOICE_AGENT_DISCLOSURE_TEXT_EN!
    : process.env.VOICE_AGENT_DISCLOSURE_TEXT_ZH!;
}

function parseAmd(value: unknown): VoiceAgentAmdCategory | null {
  return ["human", "machine-ivr", "machine-vm", "machine-unavailable", "uncertain"]
      .includes(String(value))
    ? value as VoiceAgentAmdCategory
    : null;
}

function strings(value: unknown, maximumItems: number, maximumBytes: number) {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  return value.every((item) => bounded(item, maximumBytes))
    ? value as string[]
    : null;
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function optional(value: unknown, maximum: number) {
  return value === undefined || bounded(value, maximum);
}

function bindingError(reply: Parameters<typeof sendError>[0], code: string) {
  return sendError(reply, 409, `voice_agent_${code}`, "Voice Agent binding failed");
}
