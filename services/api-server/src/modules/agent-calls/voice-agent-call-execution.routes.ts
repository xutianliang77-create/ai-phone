import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { ensureCallRoom } from "../call-links/call-room-worker.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { findProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { findAgentCallDraftById } from "./agent-calls-runtime.repository.js";
import {
  isInternalAuthorized,
} from "./agent-call-route-helpers.js";
import { verifyAgentCallLease } from "./agent-call-lease-runtime.repository.js";
import { getVoiceAgentRuntimeReadiness } from "./voice-agent-runtime-readiness.js";
import { getVoiceAgentRuntimeSupervisor } from "./voice-agent-runtime-supervisor.js";
import {
  configuredAgentCallProvider,
  isAgentCallDialOperation,
} from "./agent-call-provider-profile.js";
import { getAgentCallTelephonyRuntime } from
  "./agent-call-telephony-runtime.js";
import { executePhoneOutbound } from "./phone-outbound-coordinator.js";

export function registerVoiceAgentCallExecutionRoutes(app: FastifyInstance) {
  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/prepare-runtime",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const workerId = header(request.headers["x-agent-worker-id"]);
      const leaseToken = header(request.headers["x-agent-call-lease-token"]);
      const draftId = (request.params as { draftId: string }).draftId;
      const draft = await findAgentCallDraftById(draftId);
      if (!draft || !workerId || !leaseToken ||
        !verifyAgentCallLease(draft, workerId, leaseToken)) {
        return sendError(reply, 409, "agent_call_lease_conflict", "Worker lease is invalid");
      }
      const readiness = getVoiceAgentRuntimeReadiness();
      const configuredProvider = configuredAgentCallProvider();
      const telephony = configuredProvider
        ? getAgentCallTelephonyRuntime(configuredProvider)
        : { ok: false as const, issues: ["Agent call provider is not configured"] };
      if (readiness.status !== "ready" || !telephony.ok) {
        return reply.status(503).send({
          error: {
            code: "voice_agent_runtime_not_ready",
            message: "Voice Agent runtime is not configured",
          },
          readiness,
          telephonyIssues: telephony.ok ? [] : telephony.issues,
        });
      }
      if (!draft.callId || !draft.targetPhone || !draft.providerOperationId) {
        return sendError(
          reply,
          409,
          "agent_call_runtime_binding_missing",
          "Agent call runtime binding is missing",
        );
      }
      const call = await findCallLink(draft.callId);
      if (!call || call.purpose !== "voice_agent" || call.userId !== draft.userId) {
        return sendError(
          reply,
          409,
          "agent_call_room_binding_conflict",
          "Agent call room binding failed",
        );
      }
      const room = await ensureCallRoom(call);
      if (!room.ok) {
        return sendError(reply, 503, "agent_call_room_failed", "Agent call room failed");
      }
      const operation = await findProviderOperation(draft.providerOperationId);
      if (!operation || operation.sessionId !== call.sessionId ||
        operation.provider !== configuredProvider ||
        !isAgentCallDialOperation(operation)) {
        return sendError(
          reply,
          409,
          "agent_call_dial_operation_conflict",
          "Agent dial operation binding failed",
        );
      }
      let payload;
      try {
        payload = await telephony.runtime.buildPayload({ draft, call, operation });
      } catch (error) {
        request.log.error(
          { draftId, err: error },
          "Agent telephony binding preparation failed",
        );
        return sendError(
          reply,
          503,
          "agent_call_telephony_binding_not_ready",
          "Agent telephony binding is not ready",
        );
      }
      const runtime = getVoiceAgentRuntimeSupervisor();
      try {
        await runtime.ensure(call.callId);
      } catch (error) {
        await Promise.resolve(telephony.runtime.releasePayload?.(payload))
          .catch(() => undefined);
        request.log.error({ draftId, err: error }, "Voice Agent runtime dispatch failed");
        return sendError(
          reply,
          503,
          "voice_agent_dispatch_failed",
          "Voice Agent runtime did not become ready",
        );
      }
      return withSessionWriteLock(call.sessionId, async () => {
        const currentDraft = await findAgentCallDraftById(draftId);
        if (!currentDraft || currentDraft.status !== "dispatching" ||
          !verifyAgentCallLease(currentDraft, workerId, leaseToken)) {
          await runtime.stop(call.callId);
          await Promise.resolve(telephony.runtime.releasePayload?.(payload))
            .catch(() => undefined);
          return sendError(
            reply, 409, "agent_call_lease_conflict", "Worker lease expired",
          );
        }
        if (currentDraft.providerOperationId !== operation.id) {
          await runtime.stop(call.callId);
          await Promise.resolve(telephony.runtime.releasePayload?.(payload))
            .catch(() => undefined);
          return sendError(
            reply,
            409,
            "agent_call_dial_operation_conflict",
            "Agent dial operation binding failed",
          );
        }
        const result = await executePhoneOutbound({
          operation,
          provider: telephony.runtime.adapter,
          payload,
          timeoutMs: telephony.runtime.timeoutMs,
        });
        if (result.ok) {
          return reply.status(202).send({
            status: "in_progress",
            providerOperationStatus: "accepted",
            providerCallId: result.providerCallId,
            resultSummary: "Voice Agent runtime ready; phone dial accepted",
          });
        }
        if (result.reconciliationRequired) {
          return reply.status(202).send({
            status: "failed",
            providerOperationStatus: "unknown",
            providerCallId: result.operation.externalOperationId,
            failureReason: result.errorClass,
            nextStep: "核对电话 provider 最终状态后再决定是否重试。",
          });
        }
        await runtime.stop(call.callId);
        await Promise.resolve(telephony.runtime.releasePayload?.(payload))
          .catch(() => undefined);
        return reply.status(200).send({
          status: "failed",
          providerOperationStatus: "failed",
          failureReason: result.errorClass,
          nextStep: "检查电话 provider、号码策略和运行时 readiness。",
        });
      });
    },
  );
}

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
