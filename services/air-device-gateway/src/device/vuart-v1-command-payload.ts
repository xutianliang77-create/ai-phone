import type { AirDeviceSessionBinding } from "./device-session-router.js";
import { VuartFrameType } from "./vuart-frame.js";
import {
  isVuartV1Uint as isUint,
  reverseVuartV1Code as reverse,
  VuartV1PayloadReader as Reader,
  VuartV1PayloadWriter as Writer,
} from "./vuart-v1-payload-binary.js";

const VERSION = 1;
const MAX_SAFE_FENCE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_CAPABILITY_FLAGS = 0x0f;
const MIN_AUDIO_PAYLOAD_BYTES = 6_461;
const E164 = /^\+[1-9]\d{7,14}$/;
const DTMF = /^[0-9*#A-D]{1,64}$/;

const DEVICE_STATE = {
  ready: 1,
  in_call: 2,
  quarantined: 3,
  fault: 4,
} as const;

const COMMAND_TYPE = {
  dial: VuartFrameType.DIAL,
  hangup: VuartFrameType.HANGUP,
  dtmf: VuartFrameType.DTMF,
} as const;

const ERROR_CODE = {
  unsupported_command: 1,
  stale_fence: 2,
  binding_mismatch: 3,
  stale_generation: 4,
  idempotency_conflict: 5,
  invalid_state: 6,
  invalid_argument: 7,
  internal_error: 8,
} as const;

export const VuartV1Capability = {
  CALL_CONTROL: 0x01,
  AUDIO_DOWNLINK_16K: 0x02,
  AUDIO_UPLINK_16K: 0x04,
  DTMF: 0x08,
} as const;

export type VuartV1DeviceState = keyof typeof DEVICE_STATE;
export type VuartV1CommandName = keyof typeof COMMAND_TYPE;
export type VuartV1ErrorCode = keyof typeof ERROR_CODE;

export interface VuartV1HelloPayload {
  deviceId: string;
  bootId: string;
  firmwareVersion: string;
  protocolVersion: 1;
  capabilityFlags: number;
  maxPayloadBytes: number;
}

export interface VuartV1HeartbeatPayload {
  deviceId: string;
  bootId: string;
  heartbeatSequence: number;
  uptimeMs: bigint;
  deviceState: VuartV1DeviceState;
  activeBinding?: AirDeviceSessionBinding;
}

export interface VuartV1CommandContext extends AirDeviceSessionBinding {
  providerOperationId: string;
  commandId: string;
  idempotencyKey: string;
}

export type VuartV1DeviceCommand = VuartV1CommandContext & (
  | { type: "dial"; dialTargetE164: string }
  | { type: "hangup" }
  | { type: "dtmf"; digits: string }
);

export interface VuartV1AckPayload extends VuartV1CommandContext {
  requestFrameSequence: number;
  commandType: VuartV1CommandName;
  result: "applied";
}

export interface VuartV1ErrorPayload extends VuartV1CommandContext {
  requestFrameSequence: number;
  commandType: VuartV1CommandName;
  errorCode: VuartV1ErrorCode;
}

export function encodeVuartV1HelloPayload(input: VuartV1HelloPayload) {
  const writer = new Writer();
  writer.u8(VERSION, "payloadVersion");
  writer.identifier(input.deviceId, 128, "deviceId");
  writer.identifier(input.bootId, 128, "bootId");
  writer.identifier(input.firmwareVersion, 64, "firmwareVersion");
  if (input.protocolVersion !== VERSION) throw new Error("protocol version unsupported");
  writer.u8(input.protocolVersion, "protocolVersion");
  if (!isUint(input.capabilityFlags, MAX_CAPABILITY_FLAGS)) {
    throw new Error("VUART v1 capability flags unsupported");
  }
  writer.u16(input.capabilityFlags, "capabilityFlags");
  if (!isUint(input.maxPayloadBytes, 0xffff) ||
    input.maxPayloadBytes < MIN_AUDIO_PAYLOAD_BYTES) {
    throw new Error("VUART v1 max payload bytes cannot carry audio");
  }
  writer.u16(input.maxPayloadBytes, "maxPayloadBytes");
  return writer.take();
}

export function decodeVuartV1HelloPayload(payload: Uint8Array) {
  const reader = new Reader(payload);
  reader.version(VERSION);
  const output: VuartV1HelloPayload = {
    deviceId: reader.identifier(128, "deviceId"),
    bootId: reader.identifier(128, "bootId"),
    firmwareVersion: reader.identifier(64, "firmwareVersion"),
    protocolVersion: reader.u8("protocolVersion") as 1,
    capabilityFlags: reader.u16("capabilityFlags"),
    maxPayloadBytes: reader.u16("maxPayloadBytes"),
  };
  reader.end();
  return decodeVuartV1HelloPayloadValidated(output);
}

function decodeVuartV1HelloPayloadValidated(input: VuartV1HelloPayload) {
  encodeVuartV1HelloPayload(input);
  return input;
}

export function encodeVuartV1HeartbeatPayload(input: VuartV1HeartbeatPayload) {
  assertHeartbeatBinding(input.deviceState, input.activeBinding);
  const writer = new Writer();
  writer.u8(VERSION, "payloadVersion");
  writer.identifier(input.deviceId, 128, "deviceId");
  writer.identifier(input.bootId, 128, "bootId");
  writer.u32(input.heartbeatSequence, "heartbeatSequence");
  writer.u64(input.uptimeMs, "uptimeMs");
  writer.u8(DEVICE_STATE[input.deviceState], "deviceState");
  writer.u8(input.activeBinding ? 1 : 0, "activeBindingPresent");
  if (input.activeBinding) encodeBinding(writer, input.activeBinding);
  return writer.take();
}

export function decodeVuartV1HeartbeatPayload(payload: Uint8Array) {
  const reader = new Reader(payload);
  reader.version(VERSION);
  const deviceId = reader.identifier(128, "deviceId");
  const bootId = reader.identifier(128, "bootId");
  const heartbeatSequence = reader.u32("heartbeatSequence");
  const uptimeMs = reader.u64("uptimeMs");
  const deviceState = reverse(DEVICE_STATE, reader.u8("deviceState"), "device state");
  const present = reader.u8("activeBindingPresent");
  if (present > 1) throw new Error("VUART v1 heartbeat binding marker invalid");
  const activeBinding = present === 1 ? decodeBinding(reader) : undefined;
  reader.end();
  assertHeartbeatBinding(deviceState, activeBinding);
  return { deviceId, bootId, heartbeatSequence, uptimeMs, deviceState,
    ...(activeBinding ? { activeBinding } : {}) };
}

export function encodeVuartV1CommandPayload(input: VuartV1DeviceCommand) {
  const writer = new Writer();
  encodeContext(writer, input);
  if (input.type === "dial") writer.text(input.dialTargetE164, 16, "E.164", E164);
  if (input.type === "dtmf") writer.text(input.digits, 64, "DTMF", DTMF);
  return writer.take();
}

export function decodeVuartV1CommandPayload(
  frameType: number,
  payload: Uint8Array,
): VuartV1DeviceCommand {
  const type = reverse(COMMAND_TYPE, frameType, "command type");
  const reader = new Reader(payload);
  const context = decodeContext(reader);
  const output = type === "dial"
    ? { ...context, type, dialTargetE164: reader.text(16, "E.164", E164) }
    : type === "dtmf"
      ? { ...context, type, digits: reader.text(64, "DTMF", DTMF) }
      : { ...context, type };
  reader.end();
  return output;
}

export function encodeVuartV1AckPayload(input: VuartV1AckPayload) {
  if (input.result !== "applied") throw new Error("VUART v1 ACK result unsupported");
  const writer = new Writer();
  encodeContext(writer, input);
  writer.u32(input.requestFrameSequence, "requestFrameSequence");
  writer.u8(COMMAND_TYPE[input.commandType], "commandType");
  writer.u8(1, "result");
  return writer.take();
}

export function decodeVuartV1AckPayload(payload: Uint8Array) {
  const reader = new Reader(payload);
  const context = decodeContext(reader);
  const requestFrameSequence = reader.u32("requestFrameSequence");
  const commandType = reverse(COMMAND_TYPE, reader.u8("commandType"), "command type");
  if (reader.u8("result") !== 1) throw new Error("VUART v1 ACK result unsupported");
  reader.end();
  return { ...context, requestFrameSequence, commandType,
    result: "applied" as const };
}

export function encodeVuartV1ErrorPayload(input: VuartV1ErrorPayload) {
  const writer = new Writer();
  encodeContext(writer, input);
  writer.u32(input.requestFrameSequence, "requestFrameSequence");
  writer.u8(COMMAND_TYPE[input.commandType], "commandType");
  writer.u8(ERROR_CODE[input.errorCode], "errorCode");
  return writer.take();
}

export function decodeVuartV1ErrorPayload(payload: Uint8Array) {
  const reader = new Reader(payload);
  const context = decodeContext(reader);
  const requestFrameSequence = reader.u32("requestFrameSequence");
  const commandType = reverse(COMMAND_TYPE, reader.u8("commandType"), "command type");
  const errorCode = reverse(ERROR_CODE, reader.u8("errorCode"), "error code");
  reader.end();
  return { ...context, requestFrameSequence, commandType, errorCode };
}

function encodeContext(writer: Writer, input: VuartV1CommandContext) {
  encodeBinding(writer, input);
  writer.identifier(input.providerOperationId, 200, "providerOperationId");
  writer.identifier(input.commandId, 128, "commandId");
  writer.identifier(input.idempotencyKey, 200, "idempotencyKey");
}

function decodeContext(reader: Reader): VuartV1CommandContext {
  return { ...decodeBinding(reader),
    providerOperationId: reader.identifier(200, "providerOperationId"),
    commandId: reader.identifier(128, "commandId"),
    idempotencyKey: reader.identifier(200, "idempotencyKey") };
}

function encodeBinding(writer: Writer, input: AirDeviceSessionBinding) {
  writer.u8(VERSION, "payloadVersion");
  writer.u32(input.callGeneration, "callGeneration");
  if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) {
    throw new Error("fencingToken outside safe integer range");
  }
  writer.u64(BigInt(input.fencingToken), "fencingToken");
  writer.identifier(input.communicationSessionId, 160, "communicationSessionId");
  writer.identifier(input.providerCallId, 200, "providerCallId");
  writer.identifier(input.deviceId, 128, "deviceId");
  writer.identifier(input.leaseId, 128, "leaseId");
}

function decodeBinding(reader: Reader): AirDeviceSessionBinding {
  reader.version(VERSION);
  const callGeneration = reader.u32("callGeneration");
  const fence = reader.u64("fencingToken");
  if (fence < 1n || fence > MAX_SAFE_FENCE) {
    throw new Error("fencingToken outside safe integer range");
  }
  return { callGeneration, fencingToken: Number(fence),
    communicationSessionId: reader.identifier(160, "communicationSessionId"),
    providerCallId: reader.identifier(200, "providerCallId"),
    deviceId: reader.identifier(128, "deviceId"),
    leaseId: reader.identifier(128, "leaseId") };
}

function assertHeartbeatBinding(
  state: VuartV1DeviceState,
  binding?: AirDeviceSessionBinding,
) {
  if (!(state in DEVICE_STATE)) throw new Error("VUART v1 device state unsupported");
  if ((state === "ready" && binding) || (state === "in_call" && !binding)) {
    throw new Error("VUART v1 heartbeat state and binding mismatch");
  }
}
