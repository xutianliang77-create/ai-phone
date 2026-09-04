import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { findProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { isInternalAuthorized } from "./call-link-internal.routes.js";
import { findCallLink } from "./call-links.service.js";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";
import {
  LiveKitInputTrackBindingVerifier,
  type InputTrackParticipant,
} from "./livekit-input-track-binding.js";

type InputTrackVerifier = Pick<LiveKitInputTrackBindingVerifier, "resolve">;
let testVerifier: InputTrackVerifier | null = null;

export function registerCallLinkInputTrackAccessRoutes(app: FastifyInstance) {
  app.post(
    "/internal/call-links/:callId/input-track-access",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const params = request.params as { callId: string };
      const body = parseCallInputTrackAccessRequest(request.body);
      if (!body) {
        return sendError(
          reply,
          400,
          "invalid_input_track_access",
          "Invalid input track access request",
        );
      }
      const record = await findCallLink(params.callId);
      const session = record ? await findSession(record.sessionId) : null;
      if (!record || !session) {
        return sendError(reply, 404, "call_link_not_found", "Call link not found");
      }
      if (record.purpose !== "human_call" || record.status === "ended" ||
        Date.now() >= Date.parse(record.expiresAt)) {
        return conflict(reply);
      }
      const workerLeg = session.callLegs?.find((leg) =>
        leg.status === "active" && leg.participantRole === "worker" &&
        leg.participantIdentity === body.workerIdentity
      );
      const sourceLeg = session.callLegs?.find((leg) =>
        leg.status === "active" &&
        (leg.participantRole === "host" || leg.participantRole === "guest") &&
        leg.participantIdentity === body.participantIdentity
      );
      if (!workerLeg || !sourceLeg ||
        (sourceLeg.participantRole !== "host" &&
          sourceLeg.participantRole !== "guest")) return conflict(reply);
      if (body.dispatchGeneration !== undefined) {
        const dispatch = await findWorkerDispatch(record.sessionId);
        if (!dispatch || dispatch.generation !== body.dispatchGeneration) {
          return conflict(reply);
        }
      }
      const config = getLiveKitRoomConfig();
      if (!config.ok) {
        return sendError(
          reply,
          503,
          "call_room_provider_not_configured",
          "Call room provider not configured",
        );
      }
      try {
        const binding = await (testVerifier ??
          new LiveKitInputTrackBindingVerifier(config.config)).resolve({
            roomName: record.roomName,
            participantIdentity: body.participantIdentity,
            trackSid: body.trackSid,
            trackName: body.trackName,
          });
        const authorized = await authorizeSource({
          callId: record.callId,
          sessionId: record.sessionId,
          speakerRole: sourceLeg.participantRole,
          joinType: sourceLeg.joinType,
          participant: binding.participant,
          trackName: body.trackName,
        });
        if (!authorized) return conflict(reply);
        return {
          callId: record.callId,
          status: "authorized",
          speakerRole: sourceLeg.participantRole,
          participantIdentity: body.participantIdentity,
          trackSid: body.trackSid,
        };
      } catch {
        return conflict(reply);
      }
    },
  );
}

async function authorizeSource(input: {
  callId: string;
  sessionId: string;
  speakerRole: "host" | "guest";
  joinType: "app" | "web" | "worker" | "sip";
  participant: InputTrackParticipant;
  trackName: string;
}) {
  if (input.speakerRole === "host") {
    return input.joinType === "app" &&
      matchesRoomTokenBinding(input.participant, input.callId, "host");
  }
  const attributes = input.participant.attributes ?? {};
  if (attributes["ai.phone.transport"] === "air780") {
    return await authorizeAir780Source(input);
  }
  if (attributes["translation.operationId"]) {
    return await authorizeSipSource(input);
  }
  return input.joinType === "web" &&
    matchesRoomTokenBinding(input.participant, input.callId, "guest");
}

async function authorizeAir780Source(input: {
  sessionId: string;
  speakerRole: "host" | "guest";
  joinType: string;
  participant: InputTrackParticipant;
  trackName: string;
}) {
  const attributes = input.participant.attributes ?? {};
  const deviceId = attributes["ai.phone.device_id"];
  const leaseId = attributes["ai.phone.lease_id"];
  const generation = strictUint32(attributes["ai.phone.call_generation"]);
  if (input.speakerRole !== "guest" || input.joinType !== "sip" ||
    !identifier(deviceId) || !identifier(leaseId) || generation === null ||
    attributes["ai.phone.communication_session_id"] !== input.sessionId ||
    attributes["ai.phone.media_policy"] !== "translation_isolated" ||
    input.participant.identity !== `${input.sessionId}:guest:air:${deviceId}` ||
    input.trackName !== `air780-downlink-${deviceId}`) return false;
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return false;
  const call = await runtime.postgres.airDeviceCalls.findCurrentCallStatus({
    communicationSessionId: input.sessionId,
    deviceId,
    leaseId,
    fencingToken: generation,
    callGeneration: generation,
  });
  return call?.mediaPolicy === "translation_isolated" &&
    call.deviceId === deviceId && call.leaseId === leaseId &&
    call.callGeneration === generation;
}

async function authorizeSipSource(input: {
  sessionId: string;
  speakerRole: "host" | "guest";
  joinType: string;
  participant: InputTrackParticipant;
}) {
  const attributes = input.participant.attributes ?? {};
  const operationId = attributes["translation.operationId"];
  if (input.speakerRole !== "guest" || input.joinType !== "sip" ||
    !identifier(operationId) ||
    attributes["translation.sessionId"] !== input.sessionId ||
    attributes["translation.role"] !== "guest") return false;
  const operation = await findProviderOperation(operationId);
  return operation?.sessionId === input.sessionId &&
    operation.provider === "livekit_sip" &&
    (operation.operationType === "sip_outbound" ||
      operation.operationType === "sip_inbound") &&
    operation.status !== "failed" && operation.status !== "cancelled";
}

function matchesRoomTokenBinding(
  participant: InputTrackParticipant,
  callId: string,
  role: "host" | "guest",
) {
  const attributes = participant.attributes ?? {};
  return participant.identity.startsWith(`${callId}:${role}:`) &&
    attributes["ai.phone.call_id"] === callId &&
    attributes["ai.phone.participant_role"] === role;
}

export function parseCallInputTrackAccessRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const expectedKeys = ["workerIdentity", "participantIdentity", "trackSid",
    "trackName", ...(body.dispatchGeneration === undefined
      ? []
      : ["dispatchGeneration"])];
  if (!exactKeys(body, expectedKeys) ||
    !boundedString(body.workerIdentity, 256) ||
    !optionalGeneration(body.dispatchGeneration) ||
    !boundedString(body.participantIdentity, 256) ||
    !boundedString(body.trackSid, 128) ||
    !boundedString(body.trackName, 512)) return null;
  return {
    workerIdentity: body.workerIdentity,
    ...(body.dispatchGeneration === undefined
      ? {}
      : { dispatchGeneration: body.dispatchGeneration as number }),
    participantIdentity: body.participantIdentity,
    trackSid: body.trackSid,
    trackName: body.trackName,
  };
}

function exactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function optionalGeneration(value: unknown) {
  return value === undefined ||
    (Number.isSafeInteger(value) && Number(value) > 0);
}

function strictUint32(value: string | undefined) {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
    ? parsed
    : null;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function conflict(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    409,
    "input_track_access_binding_conflict",
    "Input track does not match the active call media binding",
  );
}

export function setLiveKitInputTrackBindingVerifierForTests(
  verifier: InputTrackVerifier | null,
) {
  testVerifier = verifier;
}
