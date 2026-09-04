import { vi } from "vitest";
import type { AirDeviceRoomClient } from
  "../media/livekit-device-participant.js";
import { encodeVuartFrame, VuartFrameType } from "../device/vuart-frame.js";
import {
  encodeVuartV1HeartbeatPayload,
  encodeVuartV1HelloPayload,
  VuartV1Capability,
} from "../device/vuart-v1-command-payload.js";
import {
  encodeVuartV1AudioPayload,
  encodeVuartV1CallStatePayload,
} from "../device/vuart-v1-payload.js";
import type { AirGatewayDaemonConfig } from "./air-gateway-config.js";

export function request(body: unknown) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.commandApiSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export function roomClient(): AirDeviceRoomClient & {
  connect: ReturnType<typeof vi.fn>;
  publishPcmTrack: ReturnType<typeof vi.fn<AirDeviceRoomClient["publishPcmTrack"]>>;
  setSubscribed: ReturnType<typeof vi.fn>;
  emitRemoteTrack(track: { sid: string; name: string;
    publisherIdentity: string }): void;
  emitAudioFrame(frame: { trackSid: string; samples: Int16Array;
    sampleRate: 16_000 }): void;
} {
  let remoteTrackListener: Parameters<NonNullable<
    AirDeviceRoomClient["onRemoteTrackPublished"]>>[0] | undefined;
  let audioFrameListener: Parameters<NonNullable<
    AirDeviceRoomClient["onSubscribedAudioFrame"]>>[0] | undefined;
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    publishPcmTrack: vi.fn(async () => undefined),
    setSubscribed: vi.fn(async () => undefined),
    onRemoteTrackPublished: vi.fn((listener) => {
      remoteTrackListener = listener;
      return () => { remoteTrackListener = undefined; };
    }),
    onSubscribedAudioFrame: vi.fn((listener) => {
      audioFrameListener = listener;
      return () => { audioFrameListener = undefined; };
    }),
    emitRemoteTrack: (track) => remoteTrackListener?.(track),
    emitAudioFrame: (frame) => audioFrameListener?.(frame),
  };
}

export function eventOutboxes() {
  const outbox = () => ({
    load: async () => [],
    put: async () => undefined,
    remove: async () => undefined,
  });
  return { carrier: outbox(), liveKit: outbox(), heartbeat: outbox() };
}

export function helloFrame() {
  return encodeVuartFrame({
    type: VuartFrameType.HELLO,
    flags: 0,
    sequence: 1,
    timestampMs: 1n,
    payload: encodeVuartV1HelloPayload({
      deviceId: binding.deviceId,
      bootId: "boot-1",
      firmwareVersion: "production-r2",
      protocolVersion: 1,
      capabilityFlags: VuartV1Capability.CALL_CONTROL |
        VuartV1Capability.AUDIO_DOWNLINK_16K |
        VuartV1Capability.AUDIO_UPLINK_16K,
      maxPayloadBytes: 8_192,
    }),
  });
}

export function heartbeatFrame(input: {
  heartbeatSequence?: number;
  deviceState?: "ready" | "in_call";
} = {}) {
  const deviceState = input.deviceState ?? "ready";
  return encodeVuartFrame({
    type: VuartFrameType.HEARTBEAT,
    flags: 0,
    sequence: 2,
    timestampMs: 2n,
    payload: encodeVuartV1HeartbeatPayload({
      deviceId: binding.deviceId,
      bootId: "boot-1",
      heartbeatSequence: input.heartbeatSequence ?? 1,
      uptimeMs: 1_000n,
      deviceState,
      ...(deviceState === "in_call" ? { activeBinding: binding } : {}),
    }),
  });
}

export function callStateFrame(input: {
  frameSequence?: number;
  eventSequence?: number;
  carrierState?: "connected" | "unknown";
} = {}) {
  return encodeVuartFrame({
    type: VuartFrameType.CALL_STATE,
    flags: 0,
    sequence: input.frameSequence ?? 4,
    timestampMs: 3_000n,
    payload: encodeVuartV1CallStatePayload({
      ...binding,
      eventSequence: input.eventSequence ?? 1,
      carrierState: input.carrierState ?? "connected",
      carrierCause: input.carrierState === "unknown" ? "unknown" : "none",
    }),
  });
}

export function audioFrame(input: {
  frameSequence?: number;
  mediaSequence?: number;
} = {}) {
  return encodeVuartFrame({
    type: VuartFrameType.AUDIO_DOWNLINK,
    flags: 0,
    sequence: input.frameSequence ?? 3,
    timestampMs: 2_000n,
    payload: encodeVuartV1AudioPayload({
      ...binding,
      mediaSequence: input.mediaSequence ?? 1,
      payload: devicePcm,
    }),
  });
}

export function samplesToBytes(samples: number[]) {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return output;
}

export const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};

export const devicePcm = Uint8Array.from(
  { length: 6_400 },
  (_, index) => (index * 17 + 3) % 256,
);

export const dial = {
  type: "dial",
  providerOperationId: "operation-1",
  commandId: "command-1",
  idempotencyKey: "dial:comm-1:1",
  ...binding,
  phoneNumberReference: "+8613800138000",
  participantIdentity: "comm-1:guest:air:air-780-1",
  roomName: "call_comm-1",
  roomAccess: {
    wsUrl: "wss://livekit.example.cn",
    token: "room-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    mediaPolicy: "translation_isolated" as const,
  },
};

export const reconcile = {
  type: "reconcile",
  providerOperationId: "reconcile-operation-1",
  commandId: "reconcile-command-1",
  idempotencyKey: "reconcile:comm-1:1",
  ...binding,
};

export function recoveryAccess() {
  return {
    ...binding,
    roomName: dial.roomName,
    participantIdentity: dial.participantIdentity,
    carrierState: "connected" as const,
    roomAccess: {
      ...dial.roomAccess,
      token: "recovery-room-token",
    },
  };
}

export const config: AirGatewayDaemonConfig = {
  hardware: {
    deploymentTarget: "beelink",
    serialPath: "/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_0001-if06",
  },
  deviceId: binding.deviceId,
  host: "127.0.0.1",
  port: 0,
  commandApiSecret: "command-secret-12345678901234567890",
  apiBaseUrl: "https://api.example.cn",
  eventApiSecret: "event-secret-123456789012345678901",
  commandLedgerPath: "/var/lib/ai-phone-air-gateway/commands.json",
  eventOutboxDirectory: "/var/lib/ai-phone-air-gateway/events",
  commandTimeoutMs: 1_000,
  responseTimeoutMs: 200,
  heartbeatTimeoutMs: 15_000,
  maxInFlightCommands: 4,
  maxCommandRecords: 16,
};
