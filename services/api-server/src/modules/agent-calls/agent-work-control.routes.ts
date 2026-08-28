import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  openAgentWorkArguments,
  sealAgentWorkArguments,
} from "./agent-work-arguments.js";
import {
  cancelAgentWork,
  createAgentWork,
  findAuthorizedAgentWorkPayload,
  findAgentWorkAuthorization,
  findAgentWork,
} from "./agent-work-runtime.repository.js";
import {
  agentWorkBinding,
  agentWorkBindingFailure,
  handleAgentWorkError,
  invalidAgentWorkRequest,
} from "./agent-work-route-support.js";
import {
  parseVoiceAgentTicketRequest,
  parseVoiceAgentWorkCancelRequest,
  parseVoiceAgentWorkRequest,
} from "./agent-work-route-request.js";
import { toAgentWorkDto } from "./agent-work-route-response.js";
import { defaultAgentWorkToolPolicyRegistry } from
  "./agent-work-tool-policy.js";
import { isInternalAuthorized } from "./agent-call-route-helpers.js";

export function registerAgentWorkControlRoutes(app: FastifyInstance) {
  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-work",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentWorkRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "Agent Work request");
      try {
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok) return agentWorkBindingFailure(reply, binding.code);
        const authorized = await findAuthorizedAgentWorkPayload({
          authorizationSnapshotId: body.authorizationSnapshotId,
          sessionId: binding.call.sessionId,
          actorId: binding.draft.userId,
        });
        const authorization = await findAgentWorkAuthorization(
          body.authorizationSnapshotId,
        );
        if (!authorized || !authorization ||
          authorized.request.permissionRequestId !== body.permissionRequestId ||
          authorization.permissionRequestId !== body.permissionRequestId) {
          return sendError(reply, 409, "agent_work_authorization_missing",
            "Agent Work authorization is unavailable");
        }
        const argumentsValue = openAgentWorkArguments({
          workId: authorized.request.permissionRequestId,
          sessionId: authorized.request.sessionId,
          actorId: authorized.request.actorId,
          toolName: authorized.request.toolName,
        }, authorized.sealedArguments, authorized.request.argumentsHash);
        const policy = defaultAgentWorkToolPolicyRegistry.require(
          authorized.request.toolName,
          authorized.request.toolVersion,
        );
        const now = new Date();
        const expiresAt = new Date(Math.min(
          Date.parse(authorized.request.expiresAt),
          Date.parse(authorization.expiresAt),
          now.getTime() + policy.maxTtlMs,
        )).toISOString();
        const payload = {
          toolName: policy.toolName,
          toolVersion: policy.toolVersion,
          submissionKey: authorized.request.submissionKey,
          argumentsHash: authorized.request.argumentsHash,
          consentSnapshotId: authorization.authorizationSnapshotId,
          explicitInstructionEvidenceHash:
            authorized.request.explicitInstructionEvidenceHash,
          policyVersion: policy.policyVersion,
          riskLevel: policy.riskLevel,
          sideEffectScopes: [...policy.sideEffectScopes],
          priority: policy.priority,
          turnGeneration: authorized.request.turnGeneration,
          dispatchGeneration: authorized.request.dispatchGeneration,
          maxAttempts: policy.maxAttempts,
          maxRuntimeMs: policy.maxRuntimeMs,
          expiresAt,
        };
        const sealedArguments = sealAgentWorkArguments({
          workId: body.workId,
          sessionId: binding.call.sessionId,
          actorId: binding.draft.userId,
          toolName: payload.toolName,
        }, argumentsValue);
        const result = await createAgentWork({
          workId: body.workId,
          agentRunId: binding.run.id,
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          turnId: body.turnId,
          actorId: binding.draft.userId,
          commandId: body.commandId,
          sealedArguments,
          payload,
        });
        return reply.status(result.status === "created" ? 201 : 200).send({
          replayed: result.status === "replayed",
          work: toAgentWorkDto(result.work),
        });
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-work/:workId/status",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentTicketRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "Agent Work status request");
      try {
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok) return agentWorkBindingFailure(reply, binding.code);
        const work = await findAgentWork({
          workId: (request.params as { workId: string }).workId,
          sessionId: binding.call.sessionId,
          actorId: binding.draft.userId,
        });
        if (!work) {
          return sendError(reply, 404, "agent_work_not_found", "Agent Work not found");
        }
        return { work: toAgentWorkDto(work) };
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/agent-work/:workId/cancel",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const body = parseVoiceAgentWorkCancelRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "Agent Work cancellation");
      try {
        const binding = await agentWorkBinding(
          (request.params as { draftId: string }).draftId,
          body.ticket,
        );
        if (!binding.ok) return agentWorkBindingFailure(reply, binding.code);
        const result = await cancelAgentWork({
          workId: (request.params as { workId: string }).workId,
          sessionId: binding.call.sessionId,
          actorId: binding.draft.userId,
          turnGeneration: body.payload.turnGeneration,
          dispatchGeneration: body.payload.dispatchGeneration,
          reason: body.payload.reason,
          commandId: body.commandId,
        });
        return {
          replayed: result.replayed,
          work: toAgentWorkDto(result.work),
        };
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );
}
