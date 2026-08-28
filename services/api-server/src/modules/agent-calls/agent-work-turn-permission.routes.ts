import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  hashAgentWorkArguments,
  sealAgentWorkArguments,
} from "./agent-work-arguments.js";
import {
  findAgentWorkPermission,
  observeAgentVoiceTurn,
  requestAgentWorkPermission,
} from "./agent-work-runtime.repository.js";
import {
  agentWorkBinding,
  agentWorkBindingFailure,
  handleAgentWorkError,
  invalidAgentWorkRequest,
} from "./agent-work-route-support.js";
import {
  parseVoiceAgentPermissionRequest,
  parseVoiceAgentTicketRequest,
  parseVoiceTurnEventRequest,
} from "./agent-work-route-request.js";
import {
  toAgentVoiceTurnScopeDto,
  toVoiceAgentPermissionRequestDto,
} from "./agent-work-route-response.js";
import { defaultAgentWorkToolPolicyRegistry } from
  "./agent-work-tool-policy.js";
import { isInternalAuthorized } from "./agent-call-route-helpers.js";

export function registerAgentWorkTurnPermissionRoutes(app: FastifyInstance) {
  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/voice-turn-events",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceTurnEventRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "voice turn event");
      try {
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok) return agentWorkBindingFailure(reply, binding.code);
        const result = await observeAgentVoiceTurn({
          eventId: body.eventId,
          agentRunId: binding.run.id,
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          actorId: binding.draft.userId,
          eventType: body.eventType,
          dispatchGeneration: binding.claim.generation,
          ...(body.explicitInstructionEvidenceHash
            ? { explicitInstructionEvidenceHash:
                body.explicitInstructionEvidenceHash }
            : {}),
          observedAt: body.observedAt,
        });
        return {
          replayed: result.status === "replayed",
          scope: toAgentVoiceTurnScopeDto(result.scope),
        };
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-work/permissions",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentPermissionRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "permission request");
      try {
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok) return agentWorkBindingFailure(reply, binding.code);
        const policy = defaultAgentWorkToolPolicyRegistry.require(
          body.toolName,
          body.toolVersion,
        );
        const argumentsHash = hashAgentWorkArguments(body.arguments);
        if (argumentsHash !== body.argumentsHash) {
          return sendError(reply, 409, "agent_work_arguments_hash_mismatch",
            "Agent Work arguments do not match the request");
        }
        const sealedArguments = sealAgentWorkArguments({
          workId: body.permissionRequestId,
          sessionId: binding.call.sessionId,
          actorId: binding.draft.userId,
          toolName: policy.toolName,
        }, body.arguments);
        const result = await requestAgentWorkPermission({
          permissionRequestId: body.permissionRequestId,
          agentRunId: binding.run.id,
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          turnId: body.turnId,
          actorId: binding.draft.userId,
          commandId: body.commandId,
          sealedArguments,
          toolName: policy.toolName,
          toolVersion: policy.toolVersion,
          submissionKey: body.submissionKey,
          argumentsHash: body.argumentsHash,
          explicitInstructionEvidenceHash:
            body.explicitInstructionEvidenceHash,
          policyVersion: policy.policyVersion,
          riskLevel: policy.riskLevel,
          sideEffectScopes: [...policy.sideEffectScopes],
          reasonCode: body.reasonCode,
          turnGeneration: body.turnGeneration,
          dispatchGeneration: body.dispatchGeneration,
          expiresAt: body.expiresAt,
        });
        return reply.status(result.status === "created" ? 201 : 200).send({
          replayed: result.status === "replayed",
          permission: toVoiceAgentPermissionRequestDto(result.request),
        });
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-work/permissions/:permissionRequestId/status",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentTicketRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "permission status request");
      try {
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok) return agentWorkBindingFailure(reply, binding.code);
        const permission = await findAgentWorkPermission({
          permissionRequestId: (request.params as {
            permissionRequestId: string;
          }).permissionRequestId,
          sessionId: binding.call.sessionId,
          actorId: binding.draft.userId,
        });
        if (!permission) {
          return sendError(reply, 404, "agent_permission_not_found",
            "Permission request not found");
        }
        return { permission: toVoiceAgentPermissionRequestDto(permission) };
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );
}
