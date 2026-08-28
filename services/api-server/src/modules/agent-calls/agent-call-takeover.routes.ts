import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  confirmCallRoomParticipant,
  readCallRoomHumanPresence,
} from "../call-links/call-room-worker.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import {
  findAgentCallDraft,
  resolveAgentCallTakeover,
  resumeAgentCallAfterTakeover,
} from "./agent-calls-runtime.repository.js";
import { toAgentCallDto } from "./agent-call-route-helpers.js";
import {
  acceptAgentHandoff,
  findActiveAgentRun,
  rejectAgentHandoff,
} from "./agent-orchestration-runtime.repository.js";
import { publishVoiceAgentControl } from "./voice-agent-control-publisher.js";
import { hasPersistedTakeoverBinding } from
  "./agent-call-takeover-binding.js";

export function registerAgentCallTakeoverRoutes(app: FastifyInstance) {
  app.post(
    "/ai-calling-agent/drafts/:draftId/takeover/accept",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const draftId = (request.params as { draftId: string }).draftId;
      const participantIdentity = parseParticipantIdentity(request.body);
      const draft = await findAgentCallDraft(account.id, draftId);
      if (!draft) return notFound(reply);
      if (!participantIdentity || !draft.callId ||
        draft.status !== "takeover_requested" ||
        !draft.takeoverReadyAt) {
        return conflict(reply, "agent_takeover_not_ready", "Takeover is not ready");
      }
      if (draft.takeoverResolvedAt) {
        if (draft.takeoverParticipantIdentity !== participantIdentity) {
          return conflict(
            reply,
            "agent_takeover_host_conflict",
            "Takeover is already bound to another host",
          );
        }
        return { draft: toAgentCallDto(draft) };
      }
      const call = await findCallLink(draft.callId);
      const hostLeg = (await findSession(draft.callId))?.callLegs?.find((leg) =>
        leg.participantIdentity === participantIdentity &&
        leg.participantRole === "host" && leg.status === "active"
      );
      const liveParticipant = call
        ? await confirmCallRoomParticipant(call, participantIdentity)
        : null;
      if (!hostLeg || !liveParticipant?.ok || !liveParticipant.connected) {
        return conflict(
          reply,
          "agent_takeover_host_not_connected",
          "Takeover host is not connected",
        );
      }
      const run = await findActiveAgentRun(draft.id, "autonomous");
      if (!run || !await acceptAgentHandoff(run.id)) {
        return conflict(reply, "agent_handoff_conflict", "Handoff cannot be accepted");
      }
      const resolved = await resolveAgentCallTakeover(
        draft.id,
        participantIdentity,
      );
      if (!resolved ||
        !hasPersistedTakeoverBinding(resolved, participantIdentity)) {
        return conflict(
          reply,
          "agent_takeover_resolution_conflict",
          "Takeover binding was not persisted; retry without enabling microphone",
        );
      }
      return { draft: toAgentCallDto(resolved) };
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/takeover/reject",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const draftId = (request.params as { draftId: string }).draftId;
      const draft = await findAgentCallDraft(account.id, draftId);
      if (!draft) return notFound(reply);
      if (draft.status !== "takeover_requested") {
        return conflict(reply, "agent_takeover_not_active", "Takeover is not active");
      }
      const call = draft.callId ? await findCallLink(draft.callId) : null;
      const presence = call ? await readCallRoomHumanPresence(call) : null;
      if (!presence?.ok) {
        return sendError(
          reply,
          503,
          "agent_takeover_presence_unavailable",
          "Takeover presence is unavailable",
        );
      }
      if (presence.presence.activeHostCount > 0) {
        return conflict(
          reply,
          "agent_takeover_host_connected",
          "Connected host must leave or accept takeover",
        );
      }
      const run = await findActiveAgentRun(draft.id, "autonomous");
      if (!run || !await rejectAgentHandoff(run.id)) {
        return conflict(reply, "agent_handoff_conflict", "Handoff cannot be rejected");
      }
      const resumed = await resumeAgentCallAfterTakeover(account.id, draft.id);
      const control = await publishVoiceAgentControl({
        callId: draft.callId!,
        command: "resume",
      });
      if (!control.ok) {
        request.log.warn(
          { callId: draft.callId, code: control.code },
          "Voice Agent resume will use heartbeat fallback",
        );
      }
      return { draft: toAgentCallDto(resumed ?? draft) };
    },
  );
}

function parseParticipantIdentity(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>).participantIdentity;
  return typeof value === "string" && value.length > 0 &&
      Buffer.byteLength(value) <= 256
    ? value
    : null;
}

function notFound(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 404, "agent_call_draft_not_found", "Draft not found");
}

function conflict(
  reply: Parameters<typeof sendError>[0],
  code: string,
  message: string,
) {
  return sendError(reply, 409, code, message);
}
