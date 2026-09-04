import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  AirDeviceMediaRecoveryAccessDto,
  AirDeviceMediaRecoveryRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { createAirDeviceCallRoomToken } from "./device-call-room-token.js";

export function registerAirDeviceMediaRecoveryRoutes(app: FastifyInstance) {
  app.post(
    "/internal/device-calls/media-recovery-access",
    async (request, reply) => {
      if (!authorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized device event");
      }
      const binding = parseAirDeviceMediaRecoveryRequest(request.body);
      if (!binding) {
        return sendError(
          reply,
          400,
          "air_device_media_recovery_invalid",
          "Invalid Air device media recovery binding",
        );
      }
      try {
        const runtime = getRepositoryRuntime();
        if (runtime.driver !== "postgres") {
          return sendError(
            reply,
            503,
            "air_device_event_storage_not_ready",
            "Air device recovery storage is not ready",
          );
        }
        const call = await runtime.postgres.airDeviceCalls
          .findRecoverableMediaBinding(binding);
        if (!call) {
          return sendError(
            reply,
            409,
            "air_device_media_recovery_stale",
            "Air device media recovery binding is stale",
          );
        }
        const issued = await createAirDeviceCallRoomToken({
          communicationSessionId: call.communicationSessionId,
          roomName: call.roomName,
          deviceId: call.deviceId,
          leaseId: call.leaseId,
          callGeneration: call.callGeneration,
          mediaPolicy: call.mediaPolicy,
        });
        if (!issued.ok || issued.participantIdentity !== call.participantIdentity) {
          throw new Error("Air device recovery room access is unavailable");
        }
        const access: AirDeviceMediaRecoveryAccessDto = {
          ...binding,
          roomName: call.roomName,
          participantIdentity: call.participantIdentity,
          carrierState: call.carrierState as
            AirDeviceMediaRecoveryAccessDto["carrierState"],
          roomAccess: {
            wsUrl: issued.wsUrl,
            token: issued.token,
            expiresAt: issued.expiresAt,
            mediaPolicy: issued.mediaPolicy,
          },
        };
        return { status: "accepted", access };
      } catch (error) {
        request.log.error(
          { err: error },
          "Air device media recovery access failed",
        );
        return sendError(
          reply,
          503,
          "air_device_media_recovery_unavailable",
          "Air device media recovery is unavailable",
        );
      }
    },
  );
}

export function parseAirDeviceMediaRecoveryRequest(
  value: unknown,
): AirDeviceMediaRecoveryRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, keys) ||
    !identifier(input.communicationSessionId, 160) ||
    !identifier(input.providerCallId, 200) ||
    !identifier(input.deviceId, 128) || !identifier(input.leaseId, 128) ||
    !Number.isSafeInteger(input.fencingToken) || Number(input.fencingToken) < 1 ||
    !uint32(input.callGeneration)) return null;
  return input as unknown as AirDeviceMediaRecoveryRequest;
}

function authorized(value: string | undefined) {
  const expected = process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET?.trim() ?? "";
  if (Buffer.byteLength(expected) < 32 || !value?.startsWith("Bearer ")) {
    return false;
  }
  const actual = Buffer.from(value.slice(7));
  const wanted = Buffer.from(expected);
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted);
}

function identifier(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function uint32(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 &&
    Number(value) <= 0xffffffff;
}

function exactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

const keys = [
  "communicationSessionId", "providerCallId", "deviceId", "leaseId",
  "fencingToken", "callGeneration",
];
