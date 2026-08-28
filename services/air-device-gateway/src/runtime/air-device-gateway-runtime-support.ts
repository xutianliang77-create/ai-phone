import { join } from "node:path";
import type {
  AirDeviceCarrierEventRequest,
  AirDeviceHeartbeatRequest,
  AirDeviceLiveKitParticipantEventRequest,
} from "@translation/contracts";
import type { AirDeviceSessionBinding } from "../device/device-session-router.js";
import type { AirDeviceBootAdmissionSnapshot } from
  "../device/air-device-boot-admission.js";
import type { VuartStreamMetrics } from
  "../device/vuart-serial-frame-transport.js";
import type { AirGatewayEventOutbox } from "./air-gateway-carrier-dispatcher.js";
import { FileAirGatewayEventOutbox } from "./file-air-gateway-event-outbox.js";

export interface AirGatewayEventOutboxes {
  carrier: AirGatewayEventOutbox<AirDeviceCarrierEventRequest>;
  liveKit: AirGatewayEventOutbox<AirDeviceLiveKitParticipantEventRequest>;
  heartbeat: AirGatewayEventOutbox<AirDeviceHeartbeatRequest>;
}

export function createAirGatewayEventOutboxes(
  directory: string,
): AirGatewayEventOutboxes {
  return {
    carrier: new FileAirGatewayEventOutbox<AirDeviceCarrierEventRequest>(
      join(directory, "carrier-events.json"),
    ),
    liveKit: new FileAirGatewayEventOutbox<
      AirDeviceLiveKitParticipantEventRequest
    >(join(directory, "livekit-events.json")),
    heartbeat: new FileAirGatewayEventOutbox<AirDeviceHeartbeatRequest>(
      join(directory, "heartbeat-events.json"),
    ),
  };
}

export function createUint32SequenceAllocator() {
  let nextSequence = 0;
  return () => {
    const value = nextSequence;
    nextSequence = (nextSequence + 1) >>> 0;
    return value;
  };
}

export function bindingOf(
  input: AirDeviceSessionBinding,
): AirDeviceSessionBinding {
  return {
    communicationSessionId: input.communicationSessionId,
    providerCallId: input.providerCallId,
    deviceId: input.deviceId,
    leaseId: input.leaseId,
    fencingToken: input.fencingToken,
    callGeneration: input.callGeneration,
  };
}

export function sameSessionBinding(
  left: AirDeviceSessionBinding,
  right: AirDeviceSessionBinding,
) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId && left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}

export function airGatewayProtocolReadiness(
  stream: VuartStreamMetrics,
  admission: AirDeviceBootAdmissionSnapshot,
) {
  return {
    stream,
    admission: {
      invalidFrames: admission.invalidFrames,
      invalidFrameReasons: admission.invalidFrameReasons,
      staleBootFrames: admission.staleBootFrames,
      staleHeartbeats: admission.staleHeartbeats,
      ...(admission.lastInvalidFrameReason
        ? { lastInvalidFrameReason: admission.lastInvalidFrameReason }
        : {}),
    },
  };
}

export function airGatewayProcessHealth(
  started: boolean,
  readiness: {
    ready: boolean;
    carrierEvents: { persistenceHealthy: boolean };
    liveKitEvents: { persistenceHealthy: boolean };
    heartbeatEvents: { persistenceHealthy: boolean };
  },
) {
  const persistenceHealthy = readiness.carrierEvents.persistenceHealthy &&
    readiness.liveKitEvents.persistenceHealthy &&
    readiness.heartbeatEvents.persistenceHealthy;
  return {
    healthy: started && persistenceHealthy,
    process: started ? "ready" : "starting",
    persistence: persistenceHealthy ? "ready" : "unavailable",
    deviceReady: readiness.ready,
  };
}
