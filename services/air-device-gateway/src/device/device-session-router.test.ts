import { describe, expect, it, vi } from "vitest";
import { BoundedDeviceAudioQueue } from "../media/device-audio-queue.js";
import {
  AirDeviceSessionRouter,
  type AirDevicePayloadDecoder,
  type AirDeviceSessionBinding,
  type SessionBoundAudioChunk,
  type SessionBoundCarrierState,
} from "./device-session-router.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";

const binding = (overrides: Partial<AirDeviceSessionBinding> = {}) => ({
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  ...overrides,
});

describe("Air device session router", () => {
  it("routes a bound 6400-byte audio chunk into ten lossless frames", () => {
    const payload = devicePayload();
    const decoder = fixtureDecoder({
      audio: { ...binding(), deviceSequence: 42, payload },
    });
    const queue = new BoundedDeviceAudioQueue(20);
    const router = new AirDeviceSessionRouter({ queue, decoder });
    router.bind(binding());

    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 99)))
      .toEqual({ accepted: true, kind: "audio", framesEnqueued: 10 });

    const frames = Array.from({ length: 10 }, () => queue.dequeue()!);
    expect(frames.map(({ deviceSequence, subframeIndex, callGeneration }) => ({
      deviceSequence,
      subframeIndex,
      callGeneration,
    }))).toEqual(Array.from({ length: 10 }, (_, subframeIndex) => ({
      deviceSequence: 42,
      subframeIndex,
      callGeneration: 3,
    })));
    expect(Uint8Array.from(frames.flatMap(({ payload: part }) => [...part])))
      .toEqual(payload);
  });

  it("publishes a carrier event only when every session binding field matches", () => {
    const exact = carrierState();
    const mismatched = carrierState({ leaseId: "stale-lease" });
    const decoder = fixtureDecoder({
      carriers: new Map([[10, exact], [11, mismatched]]),
    });
    const onCarrierEvent = vi.fn();
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(10),
      decoder,
      onCarrierEvent,
    });
    router.bind(binding());

    expect(router.route(frame(VuartFrameType.CALL_STATE, 10))).toEqual({
      accepted: true,
      kind: "carrier",
      event: exact,
    });
    expect(router.route(frame(VuartFrameType.CALL_STATE, 11))).toEqual({
      accepted: false,
      kind: "carrier",
      reason: "binding_mismatch",
    });
    expect(onCarrierEvent).toHaveBeenCalledTimes(1);
    expect(onCarrierEvent).toHaveBeenCalledWith(exact);
  });

  it.each([
    ["communicationSessionId", "comm-stale"],
    ["providerCallId", "air-call-stale"],
    ["deviceId", "air-780-stale"],
    ["leaseId", "lease-stale"],
    ["fencingToken", 6],
    ["callGeneration", 2],
  ] as const)("rejects a carrier event with a mismatched %s", (key, value) => {
    const decoder = fixtureDecoder({
      carriers: new Map([[1, carrierState({ [key]: value })]]),
    });
    const onCarrierEvent = vi.fn();
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(10),
      decoder,
      onCarrierEvent,
    });
    router.bind(binding());

    expect(router.route(frame(VuartFrameType.CALL_STATE, 1))).toEqual({
      accepted: false,
      kind: "carrier",
      reason: "binding_mismatch",
    });
    expect(onCarrierEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads and frames received without a binding", () => {
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(10),
      decoder: fixtureDecoder(),
    });

    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 1))).toEqual({
      accepted: false,
      kind: "audio",
      reason: "unbound",
    });
    router.bind(binding());
    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 2))).toEqual({
      accepted: false,
      kind: "audio",
      reason: "invalid_payload",
    });
    expect(router.route(frame(VuartFrameType.CALL_STATE, 3))).toEqual({
      accepted: false,
      kind: "carrier",
      reason: "invalid_payload",
    });
    expect(router.metrics()).toMatchObject({
      unboundFrames: 1,
      invalidPayloads: 2,
    });
  });

  it("rejects an invalid carrier state and cause combination", () => {
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(10),
      decoder: fixtureDecoder({
        carriers: new Map([[1, carrierState({ carrierCause: "remote_hangup" })]]),
      }),
    });
    router.bind(binding());

    expect(router.route(frame(VuartFrameType.CALL_STATE, 1))).toEqual({
      accepted: false,
      kind: "carrier",
      reason: "invalid_payload",
    });
  });

  it("observes carrier gaps and rejects duplicate or out-of-order events", () => {
    const decoder = fixtureDecoder({
      carriers: new Map([
        [1, carrierState({ eventSequence: 20 })],
        [2, carrierState({ eventSequence: 22 })],
        [3, carrierState({ eventSequence: 22 })],
        [4, carrierState({ eventSequence: 21 })],
      ]),
    });
    const onCarrierEvent = vi.fn();
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(10),
      decoder,
      onCarrierEvent,
    });
    router.bind(binding());

    expect(router.route(frame(VuartFrameType.CALL_STATE, 1)).accepted).toBe(true);
    expect(router.route(frame(VuartFrameType.CALL_STATE, 2)).accepted).toBe(true);
    expect(router.route(frame(VuartFrameType.CALL_STATE, 3))).toEqual({
      accepted: false,
      kind: "carrier",
      reason: "duplicate",
    });
    expect(router.route(frame(VuartFrameType.CALL_STATE, 4))).toEqual({
      accepted: false,
      kind: "carrier",
      reason: "out_of_order",
    });
    expect(onCarrierEvent).toHaveBeenCalledTimes(2);
    expect(router.metrics()).toMatchObject({
      carrierSequenceGapEvents: 1,
      missingCarrierEvents: 1,
      duplicateCarrierEvents: 1,
      outOfOrderCarrierEvents: 1,
    });
  });

  it("clears media on disconnect and requires a newer generation to rebind", () => {
    let decodedAudio: SessionBoundAudioChunk = {
      ...binding(),
      deviceSequence: 1,
      payload: devicePayload(),
    };
    const decoder: AirDevicePayloadDecoder = {
      decodeAudio: () => decodedAudio,
      decodeCallState: () => null,
    };
    const queue = new BoundedDeviceAudioQueue(20);
    const router = new AirDeviceSessionRouter({ queue, decoder });
    router.bind(binding());
    router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 1));

    router.disconnect("usb_reset");
    expect(queue.size()).toBe(0);
    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 2))).toEqual({
      accepted: false,
      kind: "audio",
      reason: "unbound",
    });
    expect(() => router.bind(binding())).toThrow("callGeneration must increase");

    decodedAudio = {
      ...binding(),
      deviceSequence: 1,
      payload: devicePayload(1),
    };
    router.bind(binding({ callGeneration: 4 }));
    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 3))).toEqual({
      accepted: false,
      kind: "audio",
      reason: "binding_mismatch",
    });
    expect(queue.size()).toBe(0);
    decodedAudio = { ...decodedAudio, callGeneration: 4 };
    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 3)).accepted)
      .toBe(true);
    expect(router.metrics()).toMatchObject({ disconnects: 1, unboundFrames: 1 });
  });

  it("surfaces audio backpressure and ends the generation on terminal carrier state", () => {
    let decodedAudio: SessionBoundAudioChunk = {
      ...binding(),
      deviceSequence: 1,
      payload: devicePayload(),
    };
    const decoder: AirDevicePayloadDecoder = {
      decodeAudio: () => decodedAudio,
      decodeCallState: (value) => value.sequence === 2
        ? carrierState({
          carrierState: "disconnected",
          carrierCause: "remote_hangup",
          eventSequence: 2,
        })
        : null,
    };
    const queue = new BoundedDeviceAudioQueue(10);
    const router = new AirDeviceSessionRouter({ queue, decoder });
    router.bind(binding());

    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 1)).accepted)
      .toBe(true);
    decodedAudio = { ...decodedAudio, deviceSequence: 2 };
    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 1))).toEqual({
      accepted: false,
      kind: "audio",
      reason: "backpressure",
    });
    expect(router.route(frame(VuartFrameType.CALL_STATE, 2)).accepted).toBe(true);
    expect(queue.size()).toBe(0);
    expect(router.route(frame(VuartFrameType.AUDIO_DOWNLINK, 3))).toEqual({
      accepted: false,
      kind: "audio",
      reason: "unbound",
    });
    expect(router.metrics()).toMatchObject({
      droppedAudioChunks: 1,
      terminalClears: 1,
    });
  });

  it("rejects a new lease that does not advance the fencing token", () => {
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(10),
      decoder: fixtureDecoder(),
    });
    router.bind(binding());
    router.disconnect("test");

    expect(() => router.bind(binding({
      leaseId: "lease-2",
      callGeneration: 4,
    }))).toThrow("fencingToken must increase for a new lease");
  });
});

function carrierState(
  overrides: Partial<SessionBoundCarrierState> = {},
): SessionBoundCarrierState {
  return {
    ...binding(),
    carrierState: "connected",
    carrierCause: "none",
    eventSequence: 10,
    deviceTimestampMs: 1_000n,
    ...overrides,
  };
}

function fixtureDecoder(input: {
  audio?: SessionBoundAudioChunk;
  carriers?: Map<number, SessionBoundCarrierState>;
} = {}): AirDevicePayloadDecoder {
  return {
    decodeAudio: () => input.audio ?? null,
    decodeCallState: (value) => input.carriers?.get(value.sequence) ?? null,
  };
}

function frame(type: number, sequence: number): VuartFrame {
  return {
    version: 1,
    type,
    flags: 0,
    sequence,
    timestampMs: BigInt(sequence),
    payload: Uint8Array.of(sequence),
  };
}

function devicePayload(seed = 0) {
  return Uint8Array.from({ length: 6_400 }, (_, index) =>
    (index + seed) % 256);
}
