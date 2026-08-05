import { describe, expect, it, vi } from "vitest";
import { decodeVuartFrame, VuartFrameType } from "../device/vuart-frame.js";
import { decodeVuartV1AudioPayload } from "../device/vuart-v1-payload.js";
import { AirGatewayTtsUplink } from "./air-gateway-tts-uplink.js";

describe("Air Gateway admitted TTS uplink", () => {
  it("aggregates ten 16k/20ms frames into one lossless VUART chunk", async () => {
    const fixture = setup();
    fixture.uplink.resume(binding);

    const expected: number[] = [];
    for (let subframe = 0; subframe < 10; subframe += 1) {
      const samples = pcmFrame(subframe);
      expected.push(...samples);
      expect(fixture.uplink.accept({ ...binding, samples, sampleRate: 16_000 }))
        .toMatchObject({ accepted: true });
    }
    await fixture.uplink.flush();

    expect(fixture.writeFrame).toHaveBeenCalledOnce();
    const frame = fixture.writeFrame.mock.calls[0]![0];
    expect(frame.type).toBe(VuartFrameType.AUDIO_UPLINK);
    expect(frame.sequence).toBe(100);
    const decoded = decodeVuartV1AudioPayload(frame.payload);
    expect(decoded).toMatchObject({ ...binding, mediaSequence: 0 });
    expect(decoded.payload).toEqual(samplesToBytes(Int16Array.from(expected)));
    expect(fixture.uplink.metrics()).toMatchObject({
      acceptedFrames: 10,
      writtenChunks: 1,
      queuedChunks: 0,
      droppedChunks: 0,
    });
  });

  it("bounds outstanding serial chunks and makes a dropped chunk observable", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fixture = setup({ capacityChunks: 1, write: () => blocked });
    fixture.uplink.resume(binding);

    offerChunk(fixture.uplink, 0);
    offerChunk(fixture.uplink, 10);
    expect(fixture.uplink.metrics()).toMatchObject({
      backpressureEvents: 1,
      droppedChunks: 1,
      droppedFrames: 10,
      outstandingChunks: 1,
    });

    release();
    await fixture.uplink.flush();
    expect(fixture.writeFrame).toHaveBeenCalledOnce();
  });

  it("rejects raw, disconnected, and old-generation audio with zero writes", async () => {
    const fixture = setup();
    fixture.uplink.resume(binding);
    fixture.connected = false;
    expect(fixture.uplink.accept({ ...binding,
      samples: pcmFrame(0), sampleRate: 16_000 })).toEqual({
      accepted: false,
      reason: "carrier_not_connected",
    });
    fixture.connected = true;
    expect(fixture.uplink.accept({ ...binding, leaseId: "stale-lease",
      samples: pcmFrame(0), sampleRate: 16_000 })).toEqual({
      accepted: false,
      reason: "binding_mismatch",
    });

    const next = { ...binding, callGeneration: 4 };
    fixture.current = next;
    fixture.uplink.resume(next);
    expect(fixture.uplink.accept({ ...binding,
      samples: pcmFrame(0), sampleRate: 16_000 })).toEqual({
      accepted: false,
      reason: "stale_generation",
    });
    expect(fixture.writeFrame).not.toHaveBeenCalled();
    expect(fixture.uplink.metrics()).toMatchObject({
      carrierRejections: 1,
      bindingMismatches: 1,
      staleGenerationFrames: 1,
      clearedPartialFrames: 0,
    });
  });

  it("rejects non-20ms/non-16k PCM before aggregation", () => {
    const fixture = setup();
    fixture.uplink.resume(binding);

    expect(fixture.uplink.accept({ ...binding,
      samples: new Int16Array(160), sampleRate: 8_000 })).toEqual({
      accepted: false,
      reason: "unsupported_format",
    });
    expect(fixture.uplink.accept({ ...binding,
      samples: new Int16Array(319), sampleRate: 16_000 })).toEqual({
      accepted: false,
      reason: "unsupported_format",
    });
    expect(fixture.uplink.metrics().invalidFrames).toBe(2);
  });
});

function setup(options: {
  capacityChunks?: number;
  write?: () => Promise<void>;
} = {}) {
  let sequence = 100;
  const writeFrame = vi.fn(async () => options.write?.());
  const state: { current: typeof binding; connected: boolean } = {
    current: binding,
    connected: true,
  };
  const uplink = new AirGatewayTtsUplink({
    transport: { writeFrame },
    nextFrameSequence: () => sequence++,
    nowMs: () => 1_000n,
    currentBinding: () => state.current,
    carrierConnected: () => state.connected,
    capacityChunks: options.capacityChunks,
  });
  return {
    uplink,
    writeFrame,
    get connected() { return state.connected; },
    set connected(value: boolean) { state.connected = value; },
    get current() { return state.current; },
    set current(value: typeof binding) { state.current = value; },
  };
}

function offerChunk(uplink: AirGatewayTtsUplink, seed: number) {
  for (let index = 0; index < 10; index += 1) {
    uplink.accept({ ...binding, samples: pcmFrame(seed + index),
      sampleRate: 16_000 });
  }
}

function pcmFrame(seed: number) {
  return Int16Array.from({ length: 320 }, (_, index) =>
    ((seed * 320 + index) % 20_000) - 10_000);
}

function samplesToBytes(samples: Int16Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};
