import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { findCallLink } from "../call-links/call-links.service.js";
import {
  findAgentWorkPermission,
  listPendingAgentWorkPermissions,
  resolveAgentWorkPermission,
} from "./agent-work-runtime.repository.js";
import {
  handleAgentWorkError,
  invalidAgentWorkRequest,
} from "./agent-work-route-support.js";
import { parseResolveVoiceAgentPermissionRequest } from
  "./agent-work-route-request.js";
import { toVoiceAgentPermissionRequestDto } from
  "./agent-work-route-response.js";
import { findAgentCallDraft } from "./agent-calls-runtime.repository.js";
import { findActiveVoiceClientOwnership } from
  "./voice-client-ownership-runtime.repository.js";

export function registerAgentWorkUserPermissionRoutes(app: FastifyInstance) {
  app.get(
    "/ai-calling-agent/drafts/:draftId/agent-work/permissions",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const draft = await findAgentCallDraft(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        const call = draft?.callId ? await findCallLink(draft.callId) : null;
        if (!draft || !call) {
          return sendError(reply, 404, "agent_call_draft_not_found",
            "Draft not found");
        }
        return {
          permissions: (await listPendingAgentWorkPermissions({
            sessionId: call.sessionId,
            actorId: account.id,
          })).map(toVoiceAgentPermissionRequestDto),
        };
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/agent-work/permissions/:permissionRequestId/resolve",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const body = parseResolveVoiceAgentPermissionRequest(request.body);
      if (!body) return invalidAgentWorkRequest(reply, "permission decision");
      try {
        const params = request.params as {
          draftId: string;
          permissionRequestId: string;
        };
        const draft = await findAgentCallDraft(account.id, params.draftId);
        const call = draft?.callId ? await findCallLink(draft.callId) : null;
        if (!draft || !call) {
          return sendError(reply, 404, "agent_call_draft_not_found",
            "Draft not found");
        }
        const permission = await findAgentWorkPermission({
          permissionRequestId: params.permissionRequestId,
          sessionId: call.sessionId,
          actorId: account.id,
        });
        if (!permission) {
          return sendError(reply, 404, "agent_permission_not_found",
            "Permission request not found");
        }
        const ownership = await findActiveVoiceClientOwnership(
          call.sessionId,
          permission.legId,
        );
        if (!ownership || ownership.accountId !== account.id ||
            ownership.clientInstanceId !== body.clientInstanceId ||
            ownership.participantIdentity !== body.participantIdentity ||
            ownership.leaseId !== body.ownershipLeaseId ||
            ownership.generation !== body.ownershipGeneration) {
          return sendError(reply, 409, "agent_permission_owner_stale",
            "Permission request is not controlled by this client");
        }
        const authorizerEvidenceHash = repositoryRequestHash({
          authorizationVersion: "agent-work-user-confirmation-v1",
          accountId: account.id,
          draftId: draft.id,
          permissionRequestId: permission.permissionRequestId,
          decision: body.decision,
          commandId: body.commandId,
          clientInstanceId: body.clientInstanceId,
          participantIdentity: body.participantIdentity,
          ownershipLeaseId: body.ownershipLeaseId,
          ownershipGeneration: body.ownershipGeneration,
          confirmedAt: body.confirmedAt,
        });
        const result = await resolveAgentWorkPermission({
          permissionRequestId: permission.permissionRequestId,
          actorId: account.id,
          clientInstanceId: body.clientInstanceId,
          participantIdentity: body.participantIdentity,
          ownershipLeaseId: body.ownershipLeaseId,
          ownershipGeneration: body.ownershipGeneration,
          turnGeneration: body.turnGeneration,
          dispatchGeneration: body.dispatchGeneration,
          decision: body.decision,
          authorizerEvidenceHash,
          commandId: body.commandId,
        });
        return {
          replayed: result.replayed,
          permission: toVoiceAgentPermissionRequestDto(result.request),
        };
      } catch (error) {
        return handleAgentWorkError(reply, error);
      }
    },
  );
}
