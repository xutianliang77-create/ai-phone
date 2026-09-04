import type { FastifyInstance, FastifyReply } from "fastify";
import {
  parseVoiceClientOwnershipAcquireRequest,
  parseVoiceClientOwnershipReleaseRequest,
  parseVoiceClientOwnershipRenewRequest,
  parseVoiceClientTakeoverConfirmRequest,
  parseVoiceClientTakeoverRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  ownershipRouteBinding,
  voiceHostParticipantAvailable,
} from "./voice-client-ownership-route-binding.js";
import {
  acquireVoiceClientOwnership,
  confirmVoiceClientOwnershipTakeover,
  findActiveVoiceClientOwnership,
  releaseVoiceClientOwnership,
  renewVoiceClientOwnership,
  requestVoiceClientOwnershipTakeover,
} from "./voice-client-ownership-runtime.repository.js";

export function registerVoiceClientOwnershipRoutes(app: FastifyInstance) {
  app.get(
    "/ai-calling-agent/drafts/:draftId/voice-ownership",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok) return ownershipBindingFailure(reply, binding.code);
        return {
          ownership: await findActiveVoiceClientOwnership(
            binding.call.sessionId,
            binding.legId,
          ),
        };
      } catch (error) {
        return handleOwnershipError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/voice-ownership/acquire",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const body = parseVoiceClientOwnershipAcquireRequest(request.body);
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok) return ownershipBindingFailure(reply, binding.code);
        if (!await voiceHostParticipantAvailable(
          binding.call,
          body.participantIdentity,
        )) {
          return sendError(reply, 409, "voice_ownership_participant_unavailable",
            "Voice client participant is unavailable");
        }
        return await acquireVoiceClientOwnership({
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          accountId: account.id,
          clientInstanceId: body.clientInstanceId,
          participantIdentity: body.participantIdentity,
          commandId: body.commandId,
          ...(body.leaseSeconds ? { leaseSeconds: body.leaseSeconds } : {}),
        });
      } catch (error) {
        return handleOwnershipError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/voice-ownership/renew",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const body = parseVoiceClientOwnershipRenewRequest(request.body);
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok) return ownershipBindingFailure(reply, binding.code);
        if (!await voiceHostParticipantAvailable(
          binding.call,
          body.participantIdentity,
        )) {
          return sendError(reply, 409, "voice_ownership_participant_unavailable",
            "Voice client participant is unavailable");
        }
        return await renewVoiceClientOwnership({
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          accountId: account.id,
          ...body,
        });
      } catch (error) {
        return handleOwnershipError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/voice-ownership/takeover",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const body = parseVoiceClientTakeoverRequest(request.body);
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok) return ownershipBindingFailure(reply, binding.code);
        if (!await voiceHostParticipantAvailable(
          binding.call,
          body.participantIdentity,
        )) {
          return sendError(reply, 409, "voice_ownership_participant_unavailable",
            "Voice client participant is unavailable");
        }
        return await requestVoiceClientOwnershipTakeover({
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          accountId: account.id,
          ...body,
        });
      } catch (error) {
        return handleOwnershipError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/voice-ownership/takeover/:takeoverId/confirm",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const body = parseVoiceClientTakeoverConfirmRequest(request.body);
        const takeoverId = (request.params as { takeoverId: string }).takeoverId;
        if (body.takeoverId !== takeoverId) {
          return sendError(reply, 409, "voice_takeover_id_mismatch",
            "Voice takeover identity changed");
        }
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok) return ownershipBindingFailure(reply, binding.code);
        if (!await voiceHostParticipantAvailable(
          binding.call,
          body.participantIdentity,
        )) {
          return sendError(reply, 409, "voice_ownership_participant_unavailable",
            "Voice client participant is unavailable");
        }
        return await confirmVoiceClientOwnershipTakeover({
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          accountId: account.id,
          ...body,
        });
      } catch (error) {
        return handleOwnershipError(reply, error);
      }
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/voice-ownership/release",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      try {
        const body = parseVoiceClientOwnershipReleaseRequest(request.body);
        const binding = await ownershipRouteBinding(
          account.id,
          (request.params as { draftId: string }).draftId,
        );
        if (!binding.ok) return ownershipBindingFailure(reply, binding.code);
        return await releaseVoiceClientOwnership({
          sessionId: binding.call.sessionId,
          legId: binding.legId,
          accountId: account.id,
          ...body,
        });
      } catch (error) {
        return handleOwnershipError(reply, error);
      }
    },
  );
}

function ownershipBindingFailure(reply: FastifyReply, code: string) {
  return sendError(reply, 409, `voice_ownership_${code}`,
    "Voice client ownership binding failed");
}

function handleOwnershipError(reply: FastifyReply, error: unknown) {
  if (error instanceof TypeError) {
    return sendError(reply, 400, "voice_ownership_request_invalid",
      "Voice client ownership request is invalid");
  }
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "voice_ownership_failed";
  if (code.includes("disabled") || code.includes("requires_postgres")) {
    return sendError(reply, 503, code, "Voice client ownership is unavailable");
  }
  return sendError(reply, 409, code, "Voice client ownership request conflicts");
}
