import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { isInternalAuthorized } from "./call-link-internal.routes.js";
import { findCallLink } from "./call-links.service.js";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";
import { LiveKitTtsTrackAccessController } from "./livekit-tts-track-access.js";

type TrackAccessController = Pick<LiveKitTtsTrackAccessController, "authorize">;
let testController: TrackAccessController | null = null;

export function registerCallLinkTtsTrackAccessRoutes(app: FastifyInstance) {
  app.post(
    "/internal/call-links/:callId/tts-track-access",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const params = request.params as { callId: string };
      const body = parseTrackAccess(request.body);
      if (!body) {
        return sendError(reply, 400, "invalid_tts_track_access", "Invalid TTS track access");
      }
      const record = await findCallLink(params.callId);
      const session = record ? await findSession(record.sessionId) : null;
      if (!record || !session) {
        return sendError(reply, 404, "call_link_not_found", "Call link not found");
      }
      if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
        return sendError(reply, 410, "call_link_expired", "Call link expired");
      }
      const targetLeg = session.callLegs?.find((leg) =>
        leg.id === body.targetLegId && leg.status === "active"
      );
      const workerLeg = session.callLegs?.find((leg) =>
        leg.id === body.workerIdentity && leg.status === "active" &&
        leg.participantRole === "worker"
      );
      if (!targetLeg || !workerLeg ||
        targetLeg.participantRole !== body.targetSpeakerRole ||
        !matchesTargetTrackName(body)) {
        return sendError(
          reply,
          409,
          "tts_track_access_binding_conflict",
          "TTS track access does not match active call legs",
        );
      }
      const config = getLiveKitRoomConfig();
      if (!config.ok) {
        return sendError(reply, 503, "call_room_provider_not_configured", "Call room provider not configured");
      }
      const controller = testController ??
        new LiveKitTtsTrackAccessController(config.config);
      try {
        const result = await controller.authorize({
          roomName: record.roomName,
          workerIdentity: body.workerIdentity,
          targetLegId: body.targetLegId,
          trackSid: body.trackSid,
          trackName: body.trackName,
        });
        return {
          callId: record.callId,
          status: "authorized",
          participantCount: result.participantCount,
        };
      } catch {
        return sendError(
          reply,
          503,
          "tts_track_access_failed",
          "TTS track access could not be enforced",
        );
      }
    },
  );
}

type TrackAccessRequest = {
  workerIdentity: string;
  targetLegId: string;
  targetSpeakerRole: "host" | "guest";
  trackSid: string;
  trackName: string;
};

function parseTrackAccess(value: unknown): TrackAccessRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!boundedString(body.workerIdentity, 256) ||
    !boundedString(body.targetLegId, 256) ||
    !["host", "guest"].includes(String(body.targetSpeakerRole)) ||
    !boundedString(body.trackSid, 128) ||
    !boundedString(body.trackName, 512)) return null;
  return body as TrackAccessRequest;
}

function matchesTargetTrackName(request: TrackAccessRequest) {
  const match = /^translation-tts-(host|guest)-[1-9][0-9]*\.([A-Za-z0-9_-]+)$/
    .exec(request.trackName);
  return match?.[1] === request.targetSpeakerRole &&
    match[2] === Buffer.from(request.targetLegId).toString("base64url");
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function setLiveKitTtsTrackAccessControllerForTests(
  controller: TrackAccessController | null,
) {
  testController = controller;
}
