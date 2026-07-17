import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { findSessionProviderOperation } from
  "../provider-operations/provider-operations.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { isInternalAuthorized } from "./agent-call-route-helpers.js";
import { requestAgentCallTakeover } from "./agent-calls.repository.js";
import {
  findAgentToolExecution,
  hasAgentRuntimeEvent,
  requestAgentToolExecution,
  updateAgentToolExecution,
} from "./agent-orchestration.repository.js";
import { resolveVoiceAgentRuntimeBinding } from
  "./voice-agent-runtime-binding.js";
import { getLiveKitSipConfig } from "../call-links/livekit-sip-readiness.js";
import { executeVoiceAgentHangup } from "./voice-agent-sip-control.js";

export function registerVoiceAgentToolGatewayRoutes(app: FastifyInstance) {
  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/tools/hangup_call/execute",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseHangupRequest(request.body);
      const draftId = (request.params as { draftId: string }).draftId;
      if (!body) {
        return sendError(reply, 400, "invalid_voice_agent_tool", "Invalid tool request");
      }
      const binding = await resolveVoiceAgentRuntimeBinding(draftId, body.ticket);
      if (!binding.ok) {
        return sendError(reply, 409, "voice_agent_tool_binding", "Tool binding failed");
      }
      if (binding.draft.status === "takeover_requested") {
        return sendError(reply, 409, "voice_agent_takeover_active", "Human takeover is active");
      }
      if (body.reason === "task_finished" &&
        !hasAgentRuntimeEvent(binding.run.id, "structured_result")) {
        return sendError(reply, 409, "voice_agent_result_required", "Result is required");
      }
      const sip = getLiveKitSipConfig();
      if (!sip.ok) {
        return sendError(reply, 503, "livekit_sip_not_configured", "SIP is not configured");
      }
      const requested = requestAgentToolExecution({
        runId: binding.run.id,
        toolName: "hangup_call",
        toolVersion: "v1",
        argumentsHash: hashArguments({ reason: body.reason }),
        riskLevel: "low",
        approved: true,
        idempotencyKey: `voice-agent-hangup:${binding.run.id}`,
      });
      updateAgentToolExecution({
        executionId: requested.execution.id,
        status: "running",
      });
      const result = await withSessionWriteLock(binding.call.sessionId, () =>
        executeVoiceAgentHangup({
          call: binding.call,
          config: sip.config,
          idempotencyKey: `voice-agent-hangup:${binding.call.sessionId}`,
        }));
      updateAgentToolExecution({
        executionId: requested.execution.id,
        status: result.ok ? "succeeded" : result.code === "unknown"
          ? "running"
          : "failed",
        ...("operation" in result && result.operation
          ? { providerOperationId: result.operation.id }
          : {}),
        resultSummary: `SIP hangup ${result.code}`,
      });
      if (!result.ok && result.code !== "unknown") {
        return sendError(reply, 503, "voice_agent_hangup_failed", "SIP hangup failed");
      }
      return reply.status(202).send({
        executionId: requested.execution.id,
        status: result.code,
        replayed: requested.status === "replayed" ||
          ("replayed" in result && result.replayed),
      });
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/tools/:toolName/authorize",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseAuthorizeRequest(request.body);
      const params = request.params as { draftId: string; toolName: string };
      if (!body || !["send_dtmf", "request_takeover"].includes(params.toolName)) {
        return sendError(reply, 400, "invalid_voice_agent_tool", "Invalid tool request");
      }
      const binding = await resolveVoiceAgentRuntimeBinding(
        params.draftId,
        body.ticket,
      );
      if (!binding.ok) {
        return sendError(reply, 409, "voice_agent_tool_binding", "Tool binding failed");
      }
      const decision = authorizeTool(params.toolName, body.arguments, binding);
      const requested = requestAgentToolExecution({
        runId: binding.run.id,
        toolName: params.toolName,
        toolVersion: "v1",
        argumentsHash: hashArguments(body.arguments),
        riskLevel: params.toolName === "request_takeover" ? "sensitive" : "low",
        approved: decision.authorized,
        idempotencyKey: body.idempotencyKey,
      });
      if (!decision.authorized) {
        updateAgentToolExecution({
          executionId: requested.execution.id,
          status: "cancelled",
          resultSummary: decision.reason,
        });
        return reply.status(409).send({
          executionId: requested.execution.id,
          authorized: false,
          reason: decision.reason,
        });
      }
      if (params.toolName === "request_takeover") {
        requestAgentCallTakeover(binding.draft.userId, binding.draft.id, {
          reason: String(body.arguments.reason).slice(0, 200),
        });
      }
      updateAgentToolExecution({
        executionId: requested.execution.id,
        status: "running",
      });
      return {
        executionId: requested.execution.id,
        authorized: true,
        replayed: requested.status === "replayed",
      };
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/tools/:executionId/complete",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseCompleteRequest(request.body);
      const params = request.params as { draftId: string; executionId: string };
      if (!body) {
        return sendError(reply, 400, "invalid_voice_agent_tool_result", "Invalid result");
      }
      const binding = await resolveVoiceAgentRuntimeBinding(
        params.draftId,
        body.ticket,
      );
      const execution = findAgentToolExecution(params.executionId);
      if (!binding.ok || !execution || execution.runId !== binding.run.id) {
        return sendError(reply, 409, "voice_agent_tool_binding", "Tool binding failed");
      }
      const updated = updateAgentToolExecution({
        executionId: execution.id,
        status: body.status,
        resultSummary: body.resultSummary,
      });
      return { execution: updated };
    },
  );
}

function authorizeTool(
  toolName: string,
  args: Record<string, unknown>,
  binding: Extract<
    Awaited<ReturnType<typeof resolveVoiceAgentRuntimeBinding>>,
    { ok: true }
  >,
) {
  if (binding.draft.status === "takeover_requested" ||
    binding.draft.status === "cancelled") {
    return denied("task_not_controllable");
  }
  if (toolName === "send_dtmf") {
    if (typeof args.digit !== "string" || !/^[0-9*#A-D]$/.test(args.digit)) {
      return denied("invalid_dtmf_digit");
    }
    const dial = findSessionProviderOperation(binding.call.sessionId, "sip_outbound");
    if (!dial || dial.status !== "active") return denied("sip_not_active");
    const ivr = hasAgentRuntimeEvent(binding.run.id, "ivr_detected");
    const disclosed = hasAgentRuntimeEvent(binding.run.id, "disclosure_completed");
    return ivr || disclosed ? allowed() : denied("disclosure_or_ivr_required");
  }
  if (toolName === "request_takeover") {
    return typeof args.reason === "string" && args.reason.length > 0 &&
        Buffer.byteLength(args.reason) <= 200
      ? allowed()
      : denied("invalid_takeover_reason");
  }
  return denied("tool_not_registered");
}

function parseAuthorizeRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!bounded(value.ticket, 4096) || !bounded(value.idempotencyKey, 128) ||
    !bounded(value.toolCallId, 128) || !value.arguments ||
    typeof value.arguments !== "object" || Array.isArray(value.arguments) ||
    Buffer.byteLength(JSON.stringify(value.arguments)) > 2048) return null;
  return {
    ticket: value.ticket,
    idempotencyKey: value.idempotencyKey,
    toolCallId: value.toolCallId,
    arguments: value.arguments as Record<string, unknown>,
  };
}

function parseCompleteRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!bounded(value.ticket, 4096) ||
    !["succeeded", "failed", "cancelled"].includes(String(value.status)) ||
    !optional(value.resultSummary, 800)) return null;
  return {
    ticket: value.ticket,
    status: value.status as "succeeded" | "failed" | "cancelled",
    ...(value.resultSummary ? { resultSummary: value.resultSummary as string } : {}),
  };
}

function parseHangupRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!bounded(value.ticket, 4096) ||
    !["task_finished", "task_cancelled", "runtime_failed"]
      .includes(String(value.reason))) return null;
  return {
    ticket: value.ticket,
    reason: value.reason as "task_finished" | "task_cancelled" | "runtime_failed",
  };
}

function hashArguments(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  )).digest("hex");
}

function allowed() {
  return { authorized: true as const };
}

function denied(reason: string) {
  return { authorized: false as const, reason };
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function optional(value: unknown, maximum: number) {
  return value === undefined || bounded(value, maximum);
}
