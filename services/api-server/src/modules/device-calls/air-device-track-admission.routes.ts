import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { createAirDeviceTrackAdmission } from
  "./device-call-track-admission.js";
import { DeviceLeaseConflict } from "./device-lease-registry.js";
import { DeviceCallBindingConflict } from
  "./postgres-air-device-calls.repository.js";

interface TrackAdmissionProcessor {
  admit(input: AirDeviceTrackAdmissionRequest):
    Promise<AirDeviceTrackAdmissionDto>;
}

let testProcessor: TrackAdmissionProcessor | null = null;

export function setAirDeviceTrackAdmissionProcessorForTests(
  processor: TrackAdmissionProcessor | null,
) {
  testProcessor = processor;
}

export function registerAirDeviceTrackAdmissionRoutes(app: FastifyInstance) {
  app.post("/internal/device-calls/track-admissions", async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized device event");
    }
    const input = parseRequest(request.body);
    if (!input) {
      return sendError(
        reply,
        400,
        "air_device_track_admission_invalid",
        "Invalid Air device track admission",
      );
    }
    const processor = resolveProcessor();
    if (!processor) {
      return sendError(
        reply,
        503,
        "air_device_event_storage_not_ready",
        "Air device event storage is not ready",
      );
    }
    try {
      const admission = await processor.admit(input);
      return { status: "accepted", admission };
    } catch (error) {
      if (error instanceof DeviceLeaseConflict ||
        error instanceof DeviceCallBindingConflict) {
        return sendError(
          reply,
          409,
          "air_device_call_binding_conflict",
          "Air device call binding is stale",
        );
      }
      request.log.error(
        {
          trackSid: input.trackSid,
          reason: error instanceof Error
            ? (error as Error & { code?: string }).code
            : undefined,
          err: error,
        },
        "Air device track admission failed",
      );
      return sendError(
        reply,
        503,
        "air_device_event_unavailable",
        "Air device track admission is unavailable",
      );
    }
  });
}

function resolveProcessor(): TrackAdmissionProcessor | null {
  if (testProcessor) return testProcessor;
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return null;
  return {
    admit: (input) => createAirDeviceTrackAdmission(input, {
      leaseVerifier: runtime.postgres.airDeviceRegistry,
      callVerifier: runtime.postgres.airDeviceCalls,
      nowMs: Date.now(),
    }),
  };
}

function parseRequest(value: unknown): AirDeviceTrackAdmissionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, keys) ||
    !bounded(input.communicationSessionId, 160) ||
    !bounded(input.roomName, 200) || !bounded(input.deviceId, 128) ||
    !bounded(input.leaseId, 128) ||
    !Number.isSafeInteger(input.fencingToken) || Number(input.fencingToken) < 1 ||
    !uint32(input.callGeneration) ||
    !bounded(input.targetParticipantIdentity, 320) ||
    !bounded(input.trackSid, 160) || !bounded(input.trackName, 512) ||
    !bounded(input.publisherIdentity, 320)) return null;
  return input as unknown as AirDeviceTrackAdmissionRequest;
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

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function uint32(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;
}

function exactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

const keys = ["communicationSessionId", "roomName", "deviceId", "leaseId",
  "fencingToken", "callGeneration", "targetParticipantIdentity", "trackSid",
  "trackName", "publisherIdentity"];
