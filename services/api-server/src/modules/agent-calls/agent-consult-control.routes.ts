import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  agentConsultBinding,
  consultResponse,
} from "./agent-consult.routes.js";
import {
  completeAgentConsultHandoff,
  findAgentConsult,
  updateAgentConsult,
} from "./agent-consult.repository.js";
import { getAgentConsultConfig } from "./agent-consult-readiness.js";
import { LiveKitAgentConsultRoom } from "./livekit-agent-consult-room.js";
import { getVoiceAgentRuntimeSupervisor } from
  "./voice-agent-runtime-supervisor.js";

type RoomControl = Pick<
  LiveKitAgentConsultRoom,
  "presence" | "move" | "remove" | "delete"
>;
type RoomFactory = (
  config: ConstructorParameters<typeof LiveKitAgentConsultRoom>[0],
) => RoomControl;
let testRoomFactory: RoomFactory | null = null;

export function setAgentConsultControlRoomFactoryForTests(
  value: RoomFactory | null,
) {
  testRoomFactory = value;
}

export function registerAgentConsultControlRoutes(app: FastifyInstance) {
  app.post(
    "/ai-calling-agent/drafts/:draftId/consults/:consultId/accept",
    async (request, reply) => {
      const binding = await authenticatedBinding(request, reply);
      if (!binding) return;
      const hostIdentity = participantIdentity(request.body);
      if (!hostIdentity) return invalid(reply);
      if (binding.consult.status === "merged") {
        return { consult: consultResponse(binding.consult), replayed: true };
      }
      if (binding.consult.status !== "connected") {
        return conflict(reply, "agent_consult_not_connected", "Consult is not connected");
      }
      const room = configuredRoom(reply);
      if (!room) return;
      const present = await room.presence(binding.consult.consultRoomName, [
        hostIdentity,
        binding.consult.operatorParticipantIdentity,
      ]);
      if (!present.ok) return unavailable(reply);
      if (present.present.length !== 2) {
        return conflict(
          reply,
          "agent_consult_participant_missing",
          "Both participants must be connected to the private consult room",
        );
      }
      const operation = beginControlOperation(binding.consult, "sip_consult_move");
      if (!operation.ok) return conflict(reply, operation.code, operation.message);
      if (operation.replayed) {
        return reply.status(operation.operation.status === "succeeded" ? 200 : 202).send({
          consult: consultResponse(findAgentConsult(binding.consult.id)!),
          replayed: true,
        });
      }
      const merging = updateAgentConsult({
        consultId: binding.consult.id,
        status: "merging",
        expectedVersion: binding.consult.version,
      });
      if (merging.status !== "updated") {
        updateProviderOperation({ operationId: operation.operation.id, status: "failed" });
        return conflict(reply, "agent_consult_version_conflict", "Consult state changed");
      }
      const moved = await room.move(
        binding.consult.consultRoomName,
        binding.consult.operatorParticipantIdentity,
        binding.consult.mainRoomName,
      );
      if (!moved.ok) {
        updateProviderOperation({
          operationId: operation.operation.id,
          status: moved.reconciliationRequired ? "unknown" : "failed",
          errorClass: moved.errorClass,
        });
        if (!moved.reconciliationRequired) {
          updateAgentConsult({
            consultId: binding.consult.id,
            status: "failed",
            failureCode: moved.errorClass,
          });
        }
        return moved.reconciliationRequired
          ? reply.status(202).send({
            consult: consultResponse(findAgentConsult(binding.consult.id)!),
            reconciliationRequired: true,
          })
          : unavailable(reply);
      }
      updateProviderOperation({
        operationId: operation.operation.id,
        status: "succeeded",
      });
      updateAgentConsult({ consultId: binding.consult.id, status: "merged" });
      return { consult: consultResponse(findAgentConsult(binding.consult.id)!) };
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/consults/:consultId/reject",
    async (request, reply) => {
      const binding = await authenticatedBinding(request, reply);
      if (!binding) return;
      if (binding.consult.status === "rejected") {
        return { consult: consultResponse(binding.consult), replayed: true };
      }
      if (!["requested", "dialing", "connected"].includes(binding.consult.status)) {
        return conflict(reply, "agent_consult_not_rejectable", "Consult cannot be rejected");
      }
      const room = configuredRoom(reply);
      if (!room) return;
      const operation = beginControlOperation(binding.consult, "sip_consult_end");
      if (!operation.ok) return conflict(reply, operation.code, operation.message);
      if (!operation.replayed) {
        updateAgentConsult({ consultId: binding.consult.id, status: "rejected" });
        const removed = await room.remove(
          binding.consult.consultRoomName,
          binding.consult.operatorParticipantIdentity,
        );
        const deleted = await room.delete(binding.consult.consultRoomName);
        const uncertain = (!removed.ok && removed.reconciliationRequired) ||
          (!deleted.ok && deleted.reconciliationRequired);
        const failed = !removed.ok || !deleted.ok;
        updateProviderOperation({
          operationId: operation.operation.id,
          status: uncertain ? "unknown" : failed ? "failed" : "succeeded",
          ...(failed ? {
            errorClass: !removed.ok ? removed.errorClass
              : !deleted.ok ? deleted.errorClass : "unavailable",
          } : {}),
        });
        if (removed.ok) finishConsultLeg(binding.consult.providerOperationId);
      }
      const current = findAgentConsult(binding.consult.id)!;
      const endOperation = findProviderOperation(operation.operation.id);
      return reply.status(endOperation?.status === "unknown" ? 202 : 200).send({
        consult: consultResponse(current),
        replayed: operation.replayed,
      });
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/consults/:consultId/complete",
    async (request, reply) => {
      const binding = await authenticatedBinding(request, reply);
      if (!binding) return;
      const hostIdentity = participantIdentity(request.body);
      if (!hostIdentity) return invalid(reply);
      if (binding.consult.status === "completed") {
        return { consult: consultResponse(binding.consult), replayed: true };
      }
      if (binding.consult.status !== "merged") {
        return conflict(reply, "agent_consult_not_merged", "Consult is not merged");
      }
      const room = configuredRoom(reply);
      if (!room) return;
      const present = await room.presence(binding.consult.mainRoomName, [
        hostIdentity,
        binding.consult.operatorParticipantIdentity,
      ]);
      if (!present.ok) return unavailable(reply);
      if (present.present.length !== 2) {
        return conflict(
          reply,
          "agent_consult_merge_unconfirmed",
          "Host and operator must be connected to the main room",
        );
      }
      await getVoiceAgentRuntimeSupervisor().stop(binding.call.callId);
      const completed = completeAgentConsultHandoff({
        consultId: binding.consult.id,
        expectedVersion: binding.consult.version,
        runId: binding.run.id,
      });
      if (completed.status !== "completed") {
        return conflict(reply, "agent_consult_version_conflict", "Consult state changed");
      }
      await room.delete(binding.consult.consultRoomName);
      return { consult: consultResponse(completed.consult) };
    },
  );
}

async function authenticatedBinding(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const account = requireAccount(request, reply);
  if (!account) return null;
  const binding = await agentConsultBinding(account.id, request.params);
  if (!binding.ok) {
    sendError(reply, binding.code, binding.error, binding.message);
    return null;
  }
  return binding;
}

function configuredRoom(reply: Parameters<typeof sendError>[0]) {
  const config = getAgentConsultConfig();
  if (!config.ok) {
    unavailable(reply);
    return null;
  }
  return (testRoomFactory ?? ((value) => new LiveKitAgentConsultRoom(value)))(
    config.config.room,
  );
}

function beginControlOperation(
  consult: NonNullable<ReturnType<typeof findAgentConsult>>,
  operationType: "sip_consult_move" | "sip_consult_end",
) {
  const requestHash = createHash("sha256")
    .update(`${operationType}:${consult.id}`)
    .digest("hex");
  const result = beginProviderOperation({
    sessionId: consult.sessionId,
    provider: "livekit_sip",
    operationType,
    operationKey: consult.id,
    idempotencyKey: `${operationType}:${consult.id}`,
    requestHash,
  });
  if (result.status === "payload_conflict" || result.status === "session_conflict") {
    return {
      ok: false as const,
      code: "agent_consult_operation_conflict",
      message: "Consult operation conflicts with an existing request",
    };
  }
  return {
    ok: true as const,
    operation: result.operation,
    replayed: result.status === "replayed",
  };
}

function finishConsultLeg(operationId?: string) {
  if (!operationId) return;
  const operation = findProviderOperation(operationId);
  if (operation && !["succeeded", "failed", "cancelled"].includes(operation.status)) {
    updateProviderOperation({ operationId, status: "succeeded" });
  }
}

function participantIdentity(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>).participantIdentity;
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 256
    ? value
    : null;
}

function invalid(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 400, "invalid_agent_consult_request", "Invalid consult request");
}

function conflict(reply: Parameters<typeof sendError>[0], code: string, message: string) {
  return sendError(reply, 409, code, message);
}

function unavailable(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 503, "agent_consult_unavailable", "Operator consultation unavailable");
}
