import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  AirDeviceCarrierEventRequest,
  AirDeviceCallDto,
  AirDeviceHeartbeatRequest,
  AirDeviceLiveKitParticipantEventRequest,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { sendError } from "../../infrastructure/http/errors.js";
import { DeviceCallBindingConflict } from
  "./postgres-air-device-calls.repository.js";
import { convergeAirDeviceCall } from
  "./air-device-agent-call-convergence.js";
import { DeviceLeaseConflict } from "./device-lease-registry.js";
import { parseAirDeviceHeartbeatRequest } from
  "./air-device-heartbeat-request.js";
import { AirDeviceHeartbeatService } from
  "./air-device-heartbeat-service.js";

interface CarrierEventProcessor {
  processCarrierEvent(input: AirDeviceCarrierEventRequest & {
    claimOwner: string;
  }): Promise<AirDeviceCallDto>;
  processLiveKitParticipantEvent?(input: AirDeviceLiveKitParticipantEventRequest & {
    claimOwner: string;
  }): Promise<AirDeviceCallDto>;
}

let testProcessor: CarrierEventProcessor | null = null;

interface HeartbeatProcessor {
  process(input: AirDeviceHeartbeatRequest): Promise<unknown>;
}

let testHeartbeatProcessor: HeartbeatProcessor | null = null;

export function setAirDeviceCarrierEventProcessorForTests(
  processor: CarrierEventProcessor | null,
) {
  testProcessor = processor;
}

export function setAirDeviceHeartbeatProcessorForTests(
  processor: HeartbeatProcessor | null,
) {
  testHeartbeatProcessor = processor;
}

export function registerAirDeviceCallRoutes(app: FastifyInstance) {
  app.post("/internal/device-calls/carrier-events", async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized device event");
    }
    const event = parseCarrierEvent(request.body);
    if (!event) {
      return sendError(
        reply,
        400,
        "air_device_carrier_event_invalid",
        "Invalid Air device carrier event",
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
      const call = await processor.processCarrierEvent({
        ...event,
        claimOwner: `air-gateway-event:${process.env.INSTANCE_ID ?? process.pid}`,
      });
      await convergeAirDeviceCall(event, call);
      return { status: "accepted", call };
    } catch (error) {
      if (error instanceof DeviceCallBindingConflict) {
        return sendError(
          reply,
          409,
          "air_device_call_binding_conflict",
          "Air device call binding is stale",
        );
      }
      request.log.error(
        { eventId: event.eventId, err: error },
        "Air device carrier event failed",
      );
      return sendError(
        reply,
        503,
        "air_device_event_unavailable",
        "Air device event processing is unavailable",
      );
    }
  });

  app.post("/internal/device-calls/livekit-events", async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized device event");
    }
    const event = parseLiveKitEvent(request.body);
    if (!event) {
      return sendError(
        reply,
        400,
        "air_device_livekit_event_invalid",
        "Invalid Air device LiveKit event",
      );
    }
    const processor = resolveProcessor();
    if (!processor?.processLiveKitParticipantEvent) {
      return sendError(
        reply,
        503,
        "air_device_event_storage_not_ready",
        "Air device event storage is not ready",
      );
    }
    try {
      const call = await processor.processLiveKitParticipantEvent({
        ...event,
        claimOwner: eventClaimOwner(),
      });
      return { status: "accepted", call };
    } catch (error) {
      if (error instanceof DeviceCallBindingConflict) {
        return sendError(
          reply,
          409,
          "air_device_call_binding_conflict",
          "Air device call binding is stale",
        );
      }
      request.log.error(
        { eventId: event.eventId, err: error },
        "Air device LiveKit event failed",
      );
      return sendError(
        reply,
        503,
        "air_device_event_unavailable",
        "Air device event processing is unavailable",
      );
    }
  });

  app.post("/internal/device-calls/heartbeats", async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized device event");
    }
    const heartbeat = parseAirDeviceHeartbeatRequest(request.body);
    if (!heartbeat) {
      return sendError(
        reply,
        400,
        "air_device_heartbeat_invalid",
        "Invalid Air device heartbeat",
      );
    }
    const processor = resolveHeartbeatProcessor();
    if (!processor) {
      return sendError(
        reply,
        503,
        "air_device_event_storage_not_ready",
        "Air device event storage is not ready",
      );
    }
    try {
      const result = await processor.process(heartbeat);
      return { status: "accepted", result };
    } catch (error) {
      if (error instanceof DeviceCallBindingConflict ||
        error instanceof DeviceLeaseConflict) {
        return sendError(
          reply,
          409,
          "air_device_call_binding_conflict",
          "Air device call binding is stale",
        );
      }
      request.log.error(
        { eventId: heartbeat.eventId, err: error },
        "Air device heartbeat failed",
      );
      return sendError(
        reply,
        503,
        "air_device_event_unavailable",
        "Air device event processing is unavailable",
      );
    }
  });
}

function resolveProcessor(): CarrierEventProcessor | null {
  if (testProcessor) return testProcessor;
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.airDeviceCallEvents
    : null;
}

function resolveHeartbeatProcessor(): HeartbeatProcessor | null {
  if (testHeartbeatProcessor) return testHeartbeatProcessor;
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? new AirDeviceHeartbeatService({
      registry: runtime.postgres.airDeviceRegistry,
      inbox: runtime.postgres.reliableInbox,
      leaseTtlSeconds: heartbeatLeaseTtlSeconds(),
      claimOwner: eventClaimOwner(),
    })
    : null;
}

function heartbeatLeaseTtlSeconds() {
  const value = Number(process.env.AIR_DEVICE_LEASE_TTL_SECONDS);
  return Number.isInteger(value) && value >= 15 && value <= 300 ? value : 60;
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

function parseCarrierEvent(value: unknown): AirDeviceCarrierEventRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, eventKeys) ||
    !bounded(input.eventId, 200) ||
    !bounded(input.communicationSessionId, 160) ||
    !bounded(input.providerCallId, 200) || !bounded(input.deviceId, 128) ||
    !bounded(input.leaseId, 128) ||
    !Number.isSafeInteger(input.fencingToken) || Number(input.fencingToken) < 1 ||
    !uint32(input.callGeneration) || !uint32(input.eventSequence) ||
    !carrierState(input.carrierState) || !carrierCause(input.carrierCause) ||
    !validStateCause(input.carrierState, input.carrierCause) ||
    typeof input.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(input.occurredAt))) return null;
  return input as unknown as AirDeviceCarrierEventRequest;
}

function parseLiveKitEvent(
  value: unknown,
): AirDeviceLiveKitParticipantEventRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, liveKitEventKeys) ||
    !bounded(input.eventId, 200) ||
    !bounded(input.communicationSessionId, 160) ||
    !bounded(input.providerCallId, 200) || !bounded(input.deviceId, 128) ||
    !bounded(input.leaseId, 128) ||
    !Number.isSafeInteger(input.fencingToken) || Number(input.fencingToken) < 1 ||
    !uint32(input.callGeneration) || !safeSequence(input.eventSequence) ||
    typeof input.liveKitParticipantState !== "string" ||
    !["absent", "joining", "joined", "reconnecting", "disconnected"]
      .includes(input.liveKitParticipantState) ||
    typeof input.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(input.occurredAt))) return null;
  return input as unknown as AirDeviceLiveKitParticipantEventRequest;
}

function validStateCause(
  state: AirDeviceCarrierEventRequest["carrierState"],
  cause: AirDeviceCarrierEventRequest["carrierCause"],
) {
  const allowed: Record<typeof state, typeof cause[]> = {
    dialing: ["none"], ringing: ["none"], connected: ["none"],
    disconnected: ["local_hangup", "remote_hangup", "no_answer", "rejected",
      "unknown"],
    busy: ["busy"], failed: ["network_error", "device_error", "unknown"],
    unknown: ["unknown"],
  };
  return allowed[state].includes(cause);
}

function carrierState(value: unknown): value is AirDeviceCarrierEventRequest["carrierState"] {
  return typeof value === "string" && ["dialing", "ringing", "connected",
    "disconnected", "busy", "failed", "unknown"].includes(value);
}

function carrierCause(value: unknown): value is AirDeviceCarrierEventRequest["carrierCause"] {
  return typeof value === "string" && ["none", "local_hangup", "remote_hangup",
    "busy", "no_answer", "rejected", "network_error", "device_error",
    "unknown"].includes(value);
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function uint32(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;
}

function safeSequence(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function exactKeys(value: object, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

const eventKeys = [
  "eventId", "communicationSessionId", "providerCallId", "deviceId", "leaseId",
  "fencingToken", "callGeneration", "eventSequence", "carrierState",
  "carrierCause", "occurredAt",
];

const liveKitEventKeys = [
  "eventId", "communicationSessionId", "providerCallId", "deviceId", "leaseId",
  "fencingToken", "callGeneration", "eventSequence",
  "liveKitParticipantState", "occurredAt",
];

function eventClaimOwner() {
  return `air-gateway-event:${process.env.INSTANCE_ID ?? process.pid}`;
}
