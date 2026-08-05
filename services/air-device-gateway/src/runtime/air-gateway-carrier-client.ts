import { createHash } from "node:crypto";
import type {
  AirDeviceCarrierEventRequest,
  AirDeviceHeartbeatRequest,
  AirDeviceLiveKitParticipantEventRequest,
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
} from "@translation/contracts";
import type { AirDeviceBootAdmissionSnapshot } from
  "../device/air-device-boot-admission.js";
import type {
  AirDeviceSessionBinding,
  SessionBoundCarrierState,
} from "../device/device-session-router.js";
import type { SessionBoundLiveKitParticipantState } from
  "./air-gateway-room-session.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class HttpAirGatewayCarrierEventClient {
  constructor(private readonly config: {
    apiBaseUrl: string;
    apiSecret: string;
    timeoutMs: number;
  }, private readonly fetchFn: FetchLike = fetch) {}

  async publish(event: AirDeviceCarrierEventRequest) {
    await this.post("carrier-events", event, "carrier");
  }

  async publishLiveKit(event: AirDeviceLiveKitParticipantEventRequest) {
    await this.post("livekit-events", event, "LiveKit");
  }

  async publishHeartbeat(event: AirDeviceHeartbeatRequest) {
    await this.post("heartbeats", event, "heartbeat");
  }

  async admitTrack(
    request: AirDeviceTrackAdmissionRequest,
  ): Promise<AirDeviceTrackAdmissionDto> {
    const body = await this.post("track-admissions", request, "track admission");
    const admission = body.admission;
    if (!matchesTrackAdmission(admission, request)) {
      throw new Error("Air device track admission response is invalid");
    }
    return admission;
  }

  private async post(
    path: "carrier-events" | "livekit-events" | "heartbeats" |
      "track-admissions",
    event: AirDeviceCarrierEventRequest | AirDeviceHeartbeatRequest |
      AirDeviceLiveKitParticipantEventRequest | AirDeviceTrackAdmissionRequest,
    label: "carrier" | "LiveKit" | "heartbeat" | "track admission",
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.config.apiBaseUrl}/internal/device-calls/${path}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiSecret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        },
      );
      const text = await response.text();
      if (Buffer.byteLength(text) > 8_192) {
        throw new Error(`Air device ${label} event response is too large`);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Air device ${label} event response is invalid`);
      }
      if (!response.ok || !body || typeof body !== "object" ||
        (body as Record<string, unknown>).status !== "accepted") {
        throw new Error(`Air device ${label} event was not accepted`);
      }
      return body as Record<string, unknown>;
    } catch (error) {
      if (controller.signal.aborted) {
        const timeout = new Error(`Air device ${label} event timed out`);
        timeout.name = "TimeoutError";
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function matchesTrackAdmission(
  value: unknown,
  request: AirDeviceTrackAdmissionRequest,
): value is AirDeviceTrackAdmissionDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const admission = value as Record<string, unknown>;
  const keys = ["trackSid", "trackName", "publisherIdentity",
    "communicationSessionId", "targetParticipantIdentity", "deviceId",
    "leaseId", "callGeneration"];
  return Object.keys(admission).length === keys.length &&
    keys.every((key) => key in admission) &&
    admission.trackSid === request.trackSid &&
    admission.trackName === request.trackName &&
    admission.publisherIdentity === request.publisherIdentity &&
    admission.communicationSessionId === request.communicationSessionId &&
    admission.targetParticipantIdentity === request.targetParticipantIdentity &&
    admission.deviceId === request.deviceId &&
    admission.leaseId === request.leaseId &&
    admission.callGeneration === request.callGeneration;
}

export function airGatewayHeartbeatRequest(
  snapshot: AirDeviceBootAdmissionSnapshot,
  observedAt = new Date(),
): AirDeviceHeartbeatRequest {
  const { hello, heartbeat } = snapshot;
  if (!hello || !heartbeat || hello.deviceId !== heartbeat.deviceId ||
    hello.bootId !== heartbeat.bootId) {
    throw new Error("Air device heartbeat does not match the admitted boot");
  }
  const eventId = `air_hb_${createHash("sha256").update(JSON.stringify({
    deviceId: heartbeat.deviceId,
    bootId: heartbeat.bootId,
    heartbeatSequence: heartbeat.heartbeatSequence,
  })).digest("hex").slice(0, 48)}`;
  return {
    eventId,
    deviceId: heartbeat.deviceId,
    bootId: heartbeat.bootId,
    firmwareVersion: hello.firmwareVersion,
    protocolVersion: `vuart-v${hello.protocolVersion}`,
    supportedSampleRates: [16_000],
    heartbeatSequence: heartbeat.heartbeatSequence,
    uptimeMs: heartbeat.uptimeMs.toString(),
    deviceState: heartbeat.deviceState,
    observedAt: observedAt.toISOString(),
    ...(heartbeat.activeBinding
      ? { activeBinding: bindingOf(heartbeat.activeBinding) }
      : {}),
  };
}

export function airGatewayLiveKitEventRequest(
  event: SessionBoundLiveKitParticipantState,
  bootId: string,
  occurredAt = new Date(),
): AirDeviceLiveKitParticipantEventRequest {
  const eventId = `air_lk_evt_${createHash("sha256").update(JSON.stringify({
    bootId,
    communicationSessionId: event.communicationSessionId,
    providerCallId: event.providerCallId,
    deviceId: event.deviceId,
    leaseId: event.leaseId,
    fencingToken: event.fencingToken,
    callGeneration: event.callGeneration,
    eventSequence: event.eventSequence,
  })).digest("hex").slice(0, 48)}`;
  return {
    eventId,
    communicationSessionId: event.communicationSessionId,
    providerCallId: event.providerCallId,
    deviceId: event.deviceId,
    leaseId: event.leaseId,
    fencingToken: event.fencingToken,
    callGeneration: event.callGeneration,
    eventSequence: event.eventSequence,
    liveKitParticipantState: event.liveKitParticipantState,
    occurredAt: occurredAt.toISOString(),
  };
}

export function airGatewayCarrierEventRequest(
  event: SessionBoundCarrierState,
  bootId: string,
  occurredAt = new Date(),
): AirDeviceCarrierEventRequest {
  const eventId = `air_evt_${createHash("sha256").update(JSON.stringify({
    bootId,
    communicationSessionId: event.communicationSessionId,
    providerCallId: event.providerCallId,
    deviceId: event.deviceId,
    leaseId: event.leaseId,
    fencingToken: event.fencingToken,
    callGeneration: event.callGeneration,
    eventSequence: event.eventSequence,
  })).digest("hex").slice(0, 48)}`;
  return {
    eventId,
    communicationSessionId: event.communicationSessionId,
    providerCallId: event.providerCallId,
    deviceId: event.deviceId,
    leaseId: event.leaseId,
    fencingToken: event.fencingToken,
    callGeneration: event.callGeneration,
    eventSequence: event.eventSequence,
    carrierState: event.carrierState,
    carrierCause: event.carrierCause,
    occurredAt: occurredAt.toISOString(),
  };
}

interface CarrierObservation {
  binding: AirDeviceSessionBinding;
  state: "dialing" | "ringing" | "connected" | "completed" | "failed" |
    "unknown";
  observedAt: string;
}

export class AirGatewayCarrierStateRegistry {
  private readonly observations = new Map<string, CarrierObservation>();

  observe(event: SessionBoundCarrierState, observedAt = new Date()) {
    const binding = bindingOf(event);
    this.observations.set(bindingKey(binding), {
      binding,
      state: phoneState(event.carrierState),
      observedAt: observedAt.toISOString(),
    });
    if (this.observations.size > 32) {
      this.observations.delete(this.observations.keys().next().value!);
    }
  }

  reconcile(binding: AirDeviceSessionBinding) {
    const observed = this.observations.get(bindingKey(binding));
    return observed
      ? { state: observed.state, observedAt: observed.observedAt }
      : null;
  }
}

function phoneState(state: SessionBoundCarrierState["carrierState"]):
CarrierObservation["state"] {
  if (state === "disconnected") return "completed";
  if (state === "busy" || state === "failed") return "failed";
  return state;
}

function bindingOf(input: AirDeviceSessionBinding): AirDeviceSessionBinding {
  return {
    communicationSessionId: input.communicationSessionId,
    providerCallId: input.providerCallId,
    deviceId: input.deviceId,
    leaseId: input.leaseId,
    fencingToken: input.fencingToken,
    callGeneration: input.callGeneration,
  };
}

function bindingKey(input: AirDeviceSessionBinding) {
  return [input.communicationSessionId, input.providerCallId, input.deviceId,
    input.leaseId, input.fencingToken, input.callGeneration].join("\u0000");
}
