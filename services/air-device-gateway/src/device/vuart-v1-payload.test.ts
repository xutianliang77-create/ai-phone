import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BoundedDeviceAudioQueue } from "../media/device-audio-queue.js";
import { AirDeviceSessionRouter } from "./device-session-router.js";
import {
  decodeVuartFrame,
  encodeVuartFrame,
  VuartFrameType,
  type VuartFrame,
} from "./vuart-frame.js";
import {
  decodeVuartV1AudioPayload,
  decodeVuartV1CallStatePayload,
  encodeVuartV1AudioPayload,
  encodeVuartV1CallStatePayload,
  VuartV1PayloadDecoder,
} from "./vuart-v1-payload.js";

const golden = JSON.parse(readFileSync(new URL(
  "../../fixtures/vuart-v1/golden-vectors.json",
  import.meta.url,
), "utf8")) as GoldenVectors;
const binding = golden.vectors.callStateConnected.binding;

describe("Air VUART v1 session payload golden vectors", () => {
  it("matches the complete CALL_STATE payload and envelope hex", () => {
    const vector = golden.vectors.callStateConnected;
    const payload = encodeVuartV1CallStatePayload({
      ...vector.binding,
      eventSequence: vector.eventSequence,
      carrierState: vector.carrierState,
      carrierCause: vector.carrierCause,
    });
    expect(toHex(payload)).toBe(vector.payloadHex);
    const encoded = encodeVuartFrame({
      type: VuartFrameType.CALL_STATE,
      flags: vector.frame.flags,
      sequence: vector.frame.sequence,
      timestampMs: BigInt(vector.frame.timestampMs),
      payload,
    });
    expect(toHex(encoded)).toBe(vector.frameHex);

    const decodedFrame = decodeVuartFrame(fromHex(vector.frameHex));
    expect(new VuartV1PayloadDecoder().decodeCallState(decodedFrame)).toEqual({
      ...vector.binding,
      eventSequence: vector.eventSequence,
      carrierState: vector.carrierState,
      carrierCause: vector.carrierCause,
      deviceTimestampMs: BigInt(vector.frame.timestampMs),
    });
  });

  it("matches the 6400-byte AUDIO_DOWNLINK vector lengths and hashes", () => {
    const vector = golden.vectors.audioDownlink16k200ms;
    const pcm = patternedPcm();
    const payload = encodeVuartV1AudioPayload({
      ...vector.binding,
      mediaSequence: vector.mediaSequence,
      payload: pcm,
    });
    const encoded = encodeVuartFrame({
      type: VuartFrameType.AUDIO_DOWNLINK,
      flags: vector.frame.flags,
      sequence: vector.frame.sequence,
      timestampMs: BigInt(vector.frame.timestampMs),
      payload,
    });

    expect(payload.byteLength).toBe(vector.payloadBytes);
    expect(sha256(payload)).toBe(vector.payloadSha256);
    expect(encoded.byteLength).toBe(vector.frameBytes);
    expect(sha256(encoded)).toBe(vector.frameSha256);
    expect(new VuartV1PayloadDecoder().decodeAudio(
      decodeVuartFrame(encoded),
    )).toEqual({
      ...vector.binding,
      deviceSequence: vector.mediaSequence,
      payload: pcm,
    });
  });

  it("matches the frozen AUDIO_UPLINK envelope and decodes the same PCM", () => {
    const vector = golden.vectors.audioUplink16k200ms;
    const pcm = patternedPcm();
    const payload = encodeVuartV1AudioPayload({
      ...vector.binding,
      mediaSequence: vector.mediaSequence,
      payload: pcm,
    });
    const encoded = encodeVuartFrame({
      type: VuartFrameType.AUDIO_UPLINK,
      flags: vector.frame.flags,
      sequence: vector.frame.sequence,
      timestampMs: BigInt(vector.frame.timestampMs),
      payload,
    });

    expect(payload.byteLength).toBe(vector.payloadBytes);
    expect(sha256(payload)).toBe(vector.payloadSha256);
    expect(encoded.byteLength).toBe(vector.frameBytes);
    expect(sha256(encoded)).toBe(vector.frameSha256);
    expect(decodeVuartV1AudioPayload(
      decodeVuartFrame(encoded).payload,
    )).toEqual({ ...vector.binding, mediaSequence: vector.mediaSequence,
      payload: pcm });
  });

  it("keeps the Lua golden table synchronized with the Node vectors", () => {
    const lua = readFileSync(new URL(
      "../../../../firmware/air780-livekit-bridge/vuart_v1_golden_vec.lua",
      import.meta.url,
    ), "utf8");
    const call = golden.vectors.callStateConnected;
    const audio = golden.vectors.audioDownlink16k200ms;
    const uplink = golden.vectors.audioUplink16k200ms;

    for (const expected of [
      `schema = "${golden.schema}"`,
      `status = "${golden.status}"`,
      `communication_session_id = "${call.binding.communicationSessionId}"`,
      `provider_call_id = "${call.binding.providerCallId}"`,
      `device_id = "${call.binding.deviceId}"`,
      `lease_id = "${call.binding.leaseId}"`,
      `fencing_token = ${call.binding.fencingToken}`,
      `call_generation = ${call.binding.callGeneration}`,
      `event_sequence = ${call.eventSequence}`,
      `carrier_state = "${call.carrierState}"`,
      `carrier_cause = "${call.carrierCause}"`,
      `frame_sequence = ${call.frame.sequence}`,
      `timestamp_ms = "${call.frame.timestampMs}"`,
      `payload_hex = "${call.payloadHex}"`,
      `frame_hex = "${call.frameHex}"`,
      `media_sequence = ${audio.mediaSequence}`,
      `frame_sequence = ${audio.frame.sequence}`,
      `timestamp_ms = "${audio.frame.timestampMs}"`,
      `payload_bytes = ${audio.payloadBytes}`,
      `payload_sha256 = "${audio.payloadSha256}"`,
      `frame_bytes = ${audio.frameBytes}`,
      `frame_sha256 = "${audio.frameSha256}"`,
      "audio_uplink_16k_200ms = {",
      `media_sequence = ${uplink.mediaSequence}`,
      `frame_sequence = ${uplink.frame.sequence}`,
      `timestamp_ms = "${uplink.frame.timestampMs}"`,
      `payload_sha256 = "${uplink.payloadSha256}"`,
      `frame_sha256 = "${uplink.frameSha256}"`,
    ]) {
      expect(lua).toContain(expected);
    }
  });

  it("routes a production-decoded audio frame through the bounded queue", () => {
    const vector = golden.vectors.audioDownlink16k200ms;
    const payload = encodeVuartV1AudioPayload({
      ...vector.binding,
      mediaSequence: vector.mediaSequence,
      payload: patternedPcm(),
    });
    const queue = new BoundedDeviceAudioQueue(10);
    const router = new AirDeviceSessionRouter({
      queue,
      decoder: new VuartV1PayloadDecoder(),
    });
    router.bind(vector.binding);

    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, payload))).toEqual({
      accepted: true,
      kind: "audio",
      framesEnqueued: 10,
    });
    expect(queue.dequeue()).toMatchObject({
      deviceSequence: vector.mediaSequence,
      subframeIndex: 0,
      callGeneration: vector.binding.callGeneration,
    });
  });
});

describe("Air VUART v1 session payload decoder", () => {
  it("round-trips canonical carrier states and audio payloads", () => {
    const call = encodeVuartV1CallStatePayload({
      ...binding,
      eventSequence: 9,
      carrierState: "busy",
      carrierCause: "busy",
    });
    expect(decodeVuartV1CallStatePayload(call)).toEqual({
      ...binding,
      eventSequence: 9,
      carrierState: "busy",
      carrierCause: "busy",
    });
    const audio = encodeVuartV1AudioPayload({
      ...binding,
      mediaSequence: 10,
      payload: patternedPcm(),
    });
    expect(decodeVuartV1AudioPayload(audio)).toEqual({
      ...binding,
      mediaSequence: 10,
      payload: patternedPcm(),
    });
  });

  it.each([
    ["payload version", (value: Uint8Array) => value.fill(2, 0, 1)],
    ["unsafe fence", (value: Uint8Array) => new DataView(value.buffer)
      .setBigUint64(5, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)],
    ["noncanonical identifier", (value: Uint8Array) => value.fill(0x2f, 14, 15)],
    ["unknown state", (value: Uint8Array) => value.fill(99, value.length - 2,
      value.length - 1)],
    ["invalid state cause", (value: Uint8Array) => value.fill(0,
      value.length - 1)],
  ])("rejects CALL_STATE with an invalid %s", (_name, corrupt) => {
    const payload = encodeVuartV1CallStatePayload({
      ...binding,
      eventSequence: 3,
      carrierState: "disconnected",
      carrierCause: "remote_hangup",
    });
    corrupt(payload);
    expect(() => decodeVuartV1CallStatePayload(payload)).toThrow();
  });

  it("rejects truncated or trailing CALL_STATE bytes", () => {
    const payload = encodeVuartV1CallStatePayload({
      ...binding,
      eventSequence: 3,
      carrierState: "connected",
      carrierCause: "none",
    });
    expect(() => decodeVuartV1CallStatePayload(payload.slice(0, -1))).toThrow();
    expect(() => decodeVuartV1CallStatePayload(join(payload, Uint8Array.of(0))))
      .toThrow();
  });

  it.each([
    ["sample rate", 4, 0x00],
    ["duration", 6, 0x00],
    ["channels", 8, 0x02],
    ["sample format", 9, 0x02],
    ["PCM length", 10, 0x01],
  ] as const)("rejects AUDIO with invalid %s", (_name, relativeOffset, byte) => {
    const payload = encodeVuartV1AudioPayload({
      ...binding,
      mediaSequence: 4,
      payload: patternedPcm(),
    });
    const audioTail = payload.byteLength - 6_400 - 12;
    payload[audioTail + relativeOffset] = byte;
    expect(() => decodeVuartV1AudioPayload(payload)).toThrow();
  });

  it("rejects the wrong frame type or nonzero reserved flags", () => {
    const payload = encodeVuartV1CallStatePayload({
      ...binding,
      eventSequence: 1,
      carrierState: "ringing",
      carrierCause: "none",
    });
    const decoder = new VuartV1PayloadDecoder();
    expect(() => decoder.decodeCallState(frame(
      VuartFrameType.AUDIO_DOWNLINK,
      payload,
    ))).toThrow("type");
    expect(() => decoder.decodeCallState({
      ...frame(VuartFrameType.CALL_STATE, payload),
      flags: 1,
    })).toThrow("flags");
  });
});

function frame(type: number, payload: Uint8Array): VuartFrame {
  return {
    version: 1,
    type,
    flags: 0,
    sequence: 1,
    timestampMs: 1n,
    payload,
  };
}
function patternedPcm() {
  return Uint8Array.from({ length: 6_400 }, (_, index) => index % 256);
}
function join(left: Uint8Array, right: Uint8Array) {
  const value = new Uint8Array(left.byteLength + right.byteLength);
  value.set(left);
  value.set(right, left.byteLength);
  return value;
}
function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function toHex(value: Uint8Array) {
  return Buffer.from(value).toString("hex");
}

function fromHex(value: string) {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

interface GoldenVectors {
  schema: string;
  status: string;
  vectors: {
    callStateConnected: CallStateGolden;
    audioDownlink16k200ms: AudioGolden;
    audioUplink16k200ms: AudioGolden;
  };
}

interface GoldenFrame {
  flags: number;
  sequence: number;
  timestampMs: string;
}

interface GoldenBinding {
  communicationSessionId: string;
  providerCallId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
}

interface CallStateGolden {
  binding: GoldenBinding;
  eventSequence: number;
  carrierState: "connected";
  carrierCause: "none";
  frame: GoldenFrame;
  payloadHex: string;
  frameHex: string;
}

interface AudioGolden {
  binding: GoldenBinding;
  mediaSequence: number;
  frame: GoldenFrame;
  payloadBytes: number;
  payloadSha256: string;
  frameBytes: number;
  frameSha256: string;
}
