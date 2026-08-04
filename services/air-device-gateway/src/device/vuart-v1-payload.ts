import type {
  AirDeviceCarrierCause,
  AirDeviceCarrierState,
  AirDevicePayloadDecoder,
  AirDeviceSessionBinding,
  SessionBoundAudioChunk,
  SessionBoundCarrierState,
} from "./device-session-router.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";

const PAYLOAD_VERSION = 1;
const SAMPLE_RATE_HZ = 16_000;
const DURATION_MS = 200;
const CHANNELS = 1;
const PCM_S16LE = 1;
const PCM_BYTES = 6_400;
const AUDIO_TAIL_BYTES = 12;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_SAFE_FENCE = BigInt(Number.MAX_SAFE_INTEGER);

const IDENTIFIER_LIMITS = {
  communicationSessionId: 160,
  providerCallId: 200,
  deviceId: 128,
  leaseId: 128,
} as const;

const STATE_TO_CODE: Record<AirDeviceCarrierState, number> = {
  dialing: 1,
  ringing: 2,
  connected: 3,
  disconnected: 4,
  busy: 5,
  failed: 6,
  unknown: 7,
};

const CODE_TO_STATE = reverse(STATE_TO_CODE);

const CAUSE_TO_CODE: Record<AirDeviceCarrierCause, number> = {
  none: 0,
  local_hangup: 1,
  remote_hangup: 2,
  busy: 3,
  no_answer: 4,
  rejected: 5,
  network_error: 6,
  device_error: 7,
  unknown: 255,
};

const CODE_TO_CAUSE = reverse(CAUSE_TO_CODE);

export interface VuartV1AudioPayload extends AirDeviceSessionBinding {
  mediaSequence: number;
  payload: Uint8Array;
}

export interface VuartV1CallStatePayload extends AirDeviceSessionBinding {
  eventSequence: number;
  carrierState: AirDeviceCarrierState;
  carrierCause: AirDeviceCarrierCause;
}

export function encodeVuartV1AudioPayload(input: VuartV1AudioPayload) {
  assertUint32(input.mediaSequence, "mediaSequence");
  if (!(input.payload instanceof Uint8Array) ||
    input.payload.byteLength !== PCM_BYTES) {
    throw new Error("VUART v1 audio PCM must contain exactly 6400 bytes");
  }
  const prefix = encodeBinding(input);
  const output = new Uint8Array(prefix.byteLength + AUDIO_TAIL_BYTES + PCM_BYTES);
  output.set(prefix);
  const offset = prefix.byteLength;
  const view = new DataView(output.buffer);
  view.setUint32(offset, input.mediaSequence, true);
  view.setUint16(offset + 4, SAMPLE_RATE_HZ, true);
  view.setUint16(offset + 6, DURATION_MS, true);
  output[offset + 8] = CHANNELS;
  output[offset + 9] = PCM_S16LE;
  view.setUint16(offset + 10, PCM_BYTES, true);
  output.set(input.payload, offset + AUDIO_TAIL_BYTES);
  return output;
}

export function decodeVuartV1AudioPayload(
  payload: Uint8Array,
): VuartV1AudioPayload {
  const reader = new PayloadReader(payload);
  const binding = decodeBinding(reader);
  const mediaSequence = reader.readUint32("mediaSequence");
  const sampleRateHz = reader.readUint16("sampleRateHz");
  const durationMs = reader.readUint16("durationMs");
  const channels = reader.readUint8("channels");
  const sampleFormat = reader.readUint8("sampleFormat");
  const pcmByteLength = reader.readUint16("pcmByteLength");
  if (sampleRateHz !== SAMPLE_RATE_HZ || durationMs !== DURATION_MS ||
    channels !== CHANNELS || sampleFormat !== PCM_S16LE ||
    pcmByteLength !== PCM_BYTES) {
    throw new Error("VUART v1 audio metadata unsupported");
  }
  const pcm = reader.readBytes(pcmByteLength, "pcm");
  reader.assertEnd();
  return { ...binding, mediaSequence, payload: pcm };
}

export function encodeVuartV1CallStatePayload(
  input: VuartV1CallStatePayload,
) {
  assertUint32(input.eventSequence, "eventSequence");
  assertStateCause(input.carrierState, input.carrierCause);
  const prefix = encodeBinding(input);
  const output = new Uint8Array(prefix.byteLength + 6);
  output.set(prefix);
  const view = new DataView(output.buffer);
  view.setUint32(prefix.byteLength, input.eventSequence, true);
  output[prefix.byteLength + 4] = STATE_TO_CODE[input.carrierState];
  output[prefix.byteLength + 5] = CAUSE_TO_CODE[input.carrierCause];
  return output;
}

export function decodeVuartV1CallStatePayload(
  payload: Uint8Array,
): VuartV1CallStatePayload {
  const reader = new PayloadReader(payload);
  const binding = decodeBinding(reader);
  const eventSequence = reader.readUint32("eventSequence");
  const carrierState = CODE_TO_STATE.get(reader.readUint8("carrierState"));
  const carrierCause = CODE_TO_CAUSE.get(reader.readUint8("carrierCause"));
  if (!carrierState || !carrierCause) {
    throw new Error("VUART v1 carrier state or cause unsupported");
  }
  assertStateCause(carrierState, carrierCause);
  reader.assertEnd();
  return { ...binding, eventSequence, carrierState, carrierCause };
}

export class VuartV1PayloadDecoder implements AirDevicePayloadDecoder {
  decodeAudio(frame: VuartFrame): SessionBoundAudioChunk {
    assertFrame(frame, VuartFrameType.AUDIO_DOWNLINK);
    const decoded = decodeVuartV1AudioPayload(frame.payload);
    return {
      communicationSessionId: decoded.communicationSessionId,
      providerCallId: decoded.providerCallId,
      deviceId: decoded.deviceId,
      leaseId: decoded.leaseId,
      fencingToken: decoded.fencingToken,
      callGeneration: decoded.callGeneration,
      deviceSequence: decoded.mediaSequence,
      payload: decoded.payload,
    };
  }

  decodeCallState(frame: VuartFrame): SessionBoundCarrierState {
    assertFrame(frame, VuartFrameType.CALL_STATE);
    return {
      ...decodeVuartV1CallStatePayload(frame.payload),
      deviceTimestampMs: frame.timestampMs,
    };
  }
}

function encodeBinding(input: AirDeviceSessionBinding) {
  assertBinding(input);
  const identifiers = identifierEntries(input).map(([name, value]) => ({
    name,
    bytes: Uint8Array.from(value, (character) => character.charCodeAt(0)),
  }));
  const output = new Uint8Array(13 + identifiers.reduce(
    (total, item) => total + 1 + item.bytes.byteLength,
    0,
  ));
  const view = new DataView(output.buffer);
  output[0] = PAYLOAD_VERSION;
  view.setUint32(1, input.callGeneration, true);
  view.setBigUint64(5, BigInt(input.fencingToken), true);
  let offset = 13;
  for (const identifier of identifiers) {
    output[offset] = identifier.bytes.byteLength;
    output.set(identifier.bytes, offset + 1);
    offset += 1 + identifier.bytes.byteLength;
  }
  return output;
}

function decodeBinding(reader: PayloadReader): AirDeviceSessionBinding {
  if (reader.readUint8("payloadVersion") !== PAYLOAD_VERSION) {
    throw new Error("VUART v1 payload version unsupported");
  }
  const callGeneration = reader.readUint32("callGeneration");
  const fencingToken = reader.readSafeUint64("fencingToken");
  const communicationSessionId = reader.readIdentifier(
    "communicationSessionId",
    IDENTIFIER_LIMITS.communicationSessionId,
  );
  const providerCallId = reader.readIdentifier(
    "providerCallId",
    IDENTIFIER_LIMITS.providerCallId,
  );
  const deviceId = reader.readIdentifier("deviceId", IDENTIFIER_LIMITS.deviceId);
  const leaseId = reader.readIdentifier("leaseId", IDENTIFIER_LIMITS.leaseId);
  return { communicationSessionId, providerCallId, deviceId, leaseId,
    fencingToken, callGeneration };
}

class PayloadReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly payload: Uint8Array) {
    this.view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  readUint8(name: string) {
    this.require(1, name);
    return this.payload[this.offset++]!;
  }

  readUint16(name: string) {
    this.require(2, name);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(name: string) {
    this.require(4, name);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readSafeUint64(name: string) {
    this.require(8, name);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    if (value < 1n || value > MAX_SAFE_FENCE) {
      throw new Error(`${name} outside safe integer range`);
    }
    return Number(value);
  }

  readIdentifier(name: keyof typeof IDENTIFIER_LIMITS, maximum: number) {
    const length = this.readUint8(`${name}Length`);
    if (length < 1 || length > maximum) {
      throw new Error(`${name} length invalid`);
    }
    const bytes = this.readBytes(length, name);
    const value = String.fromCharCode(...bytes);
    if (!IDENTIFIER_PATTERN.test(value)) {
      throw new Error(`${name} must be canonical ASCII`);
    }
    return value;
  }

  readBytes(length: number, name: string) {
    this.require(length, name);
    const value = this.payload.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  assertEnd() {
    if (this.offset !== this.payload.byteLength) {
      throw new Error("VUART v1 payload has trailing bytes");
    }
  }

  private require(length: number, name: string) {
    if (!Number.isInteger(length) || length < 0 ||
      this.offset + length > this.payload.byteLength) {
      throw new Error(`VUART v1 payload truncated at ${name}`);
    }
  }
}

function assertBinding(input: AirDeviceSessionBinding) {
  assertUint32(input.callGeneration, "callGeneration");
  if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) {
    throw new Error("fencingToken outside safe integer range");
  }
  for (const [name, value] of identifierEntries(input)) {
    if (!IDENTIFIER_PATTERN.test(value) ||
      value.length > IDENTIFIER_LIMITS[name]) {
      throw new Error(`${name} must be bounded canonical ASCII`);
    }
  }
}

function identifierEntries(input: AirDeviceSessionBinding) {
  return (Object.keys(IDENTIFIER_LIMITS) as Array<keyof typeof IDENTIFIER_LIMITS>)
    .map((name) => [name, input[name]] as const);
}

function assertUint32(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be uint32`);
  }
}

function assertFrame(frame: VuartFrame, type: number) {
  if (frame.type !== type) throw new Error("VUART v1 payload frame type mismatch");
  if (frame.flags !== 0) throw new Error("VUART v1 payload flags must be zero");
}

function assertStateCause(
  state: AirDeviceCarrierState,
  cause: AirDeviceCarrierCause,
) {
  const allowed: Record<AirDeviceCarrierState, AirDeviceCarrierCause[]> = {
    dialing: ["none"],
    ringing: ["none"],
    connected: ["none"],
    disconnected: ["local_hangup", "remote_hangup", "no_answer", "rejected",
      "unknown"],
    busy: ["busy"],
    failed: ["network_error", "device_error", "unknown"],
    unknown: ["unknown"],
  };
  if (!allowed[state]?.includes(cause)) {
    throw new Error("VUART v1 carrier state and cause combination invalid");
  }
}

function reverse<T extends string>(input: Record<T, number>) {
  return new Map(Object.entries(input).map(([key, value]) => [value, key as T]));
}
