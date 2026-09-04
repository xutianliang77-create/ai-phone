import type { FastifyInstance, FastifyReply } from "fastify";
import {
  parseAgentDeliveryCommand,
  parseAgentDeliveryLifecycleEvent,
  parseClientPlaybackReceipt,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { confirmCallRoomParticipant } from "../call-links/call-room-worker.js";
import {
  applyAgentDeliveryClientReceipt,
  applyAgentDeliveryLifecycle,
  authorizeAgentDelivery,
} from "./agent-delivery-runtime.repository.js";
import { agentWorkBinding } from "./agent-work-route-support.js";
import { isInternalAuthorized } from "./agent-call-route-helpers.js";
import { ownershipRouteBinding } from "./voice-client-ownership-route-binding.js";

export function registerAgentDeliveryRoutes(app: FastifyInstance) {
  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-deliveries/:deliveryAttemptId/authorize",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      try {
        const body = internalBody(request.body, "command");
        const command = parseAgentDeliveryCommand(body.value);
        if (!matchesAttempt(request.params, command.deliveryAttemptId) ||
            Date.parse(command.expiresAt) <= Date.now()) {
          return deliveryConflict(reply, "delivery_command_expired_or_mismatched");
        }
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok || !matchesRuntimeBinding(command, binding)) {
          return deliveryConflict(reply, "delivery_runtime_binding_conflict");
        }
        const authorized = await authorizeAgentDelivery(command);
        const presence = await confirmCallRoomParticipant(
          binding.call,
          authorized.record.clientParticipantIdentity,
        );
        if (!presence.ok || !presence.connected) {
          return deliveryConflict(reply, "delivery_client_unavailable");
        }
        return {
          authorized: true,
          expiresAt: authorized.record.expiresAt,
          playbackGeneration: authorized.record.playbackGeneration,
        };
      } catch (error) {
        return handleDeliveryError(reply, error);
      }
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-deliveries/:deliveryAttemptId/lifecycle",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      try {
        const body = internalBody(request.body, "event");
        const event = parseAgentDeliveryLifecycleEvent(body.value);
        if (!matchesAttempt(request.params, event.deliveryAttemptId)) {
          return deliveryConflict(reply, "delivery_event_attempt_mismatch");
        }
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok || !matchesRuntimeBinding(event, binding)) {
          return deliveryConflict(reply, "delivery_runtime_binding_conflict");
        }
        const applied = await applyAgentDeliveryLifecycle(event);
        return {
          replayed: applied.replayed,
          status: applied.record.status,
          serverPlaybackState: applied.record.serverPlaybackState,
          clientLifecycleQueued: applied.clientLifecycleQueued,
        };
      } catch (error) {
        return handleDeliveryError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/agent-deliveries/:deliveryAttemptId/receipts",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const receipt = parseClientPlaybackReceipt(request.body);
        if (!matchesAttempt(request.params, receipt.deliveryAttemptId)) {
          return deliveryConflict(reply, "delivery_receipt_attempt_mismatch");
        }
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok || receipt.sessionId !== binding.call.sessionId ||
            receipt.legId !== binding.legId) {
          return deliveryConflict(reply, "delivery_receipt_binding_conflict");
        }
        const presence = await confirmCallRoomParticipant(
          binding.call,
          receipt.clientParticipantIdentity,
        );
        if (!presence.ok || !presence.connected) {
          return deliveryConflict(reply, "delivery_receipt_client_unavailable");
        }
        const result = await applyAgentDeliveryClientReceipt(receipt);
        return {
          replayed: result.replayed,
          status: result.record.status,
          delivered: result.record.status === "playback_ended",
        };
      } catch (error) {
        return handleDeliveryError(reply, error);
      }
    },
  );
}

function internalBody(value: unknown, field: "command" | "event") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid Agent delivery internal request");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.ticket !== "string" || !body.ticket.trim() ||
      Buffer.byteLength(body.ticket) > 4096) {
    throw new TypeError("Invalid Agent delivery ticket");
  }
  return { ticket: body.ticket, value: body[field] };
}

function matchesAttempt(params: unknown, deliveryAttemptId: string) {
  return (params as { deliveryAttemptId: string }).deliveryAttemptId ===
    deliveryAttemptId;
}

function matchesRuntimeBinding(
  value: { sessionId: string; legId: string; dispatchGeneration: number },
  binding: Extract<Awaited<ReturnType<typeof agentWorkBinding>>, { ok: true }>,
) {
  return value.sessionId === binding.call.sessionId &&
    value.legId === binding.legId &&
    value.dispatchGeneration === binding.claim.generation;
}

function deliveryConflict(reply: FastifyReply, code: string) {
  return sendError(reply, 409, code, "Agent delivery binding conflicts");
}

function handleDeliveryError(reply: FastifyReply, error: unknown) {
  if (error instanceof TypeError) {
    return sendError(reply, 400, "agent_delivery_request_invalid",
      "Agent delivery request is invalid");
  }
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "agent_delivery_failed";
  if (code.includes("disabled") || code.includes("requires_postgres")) {
    return sendError(reply, 503, code, "Agent delivery is unavailable");
  }
  return deliveryConflict(reply, code);
}
