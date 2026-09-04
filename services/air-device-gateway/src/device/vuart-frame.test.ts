import { describe, expect, it } from "vitest";
import {
  decodeVuartFrame,
  encodeVuartFrame,
  pcm20msFrameBytes,
  VuartFrameType,
} from "./vuart-frame.js";

describe("Air VUART frame codec", () => {
  it("round-trips the versioned binary envelope", () => {
    const encoded = encodeVuartFrame({
      type: VuartFrameType.AUDIO_DOWNLINK,
      flags: 3,
      sequence: 42,
      timestampMs: 1_722_000_000_123n,
      payload: Uint8Array.from([1, 2, 3, 4]),
    });

    expect(decodeVuartFrame(encoded)).toEqual({
      version: 1,
      type: VuartFrameType.AUDIO_DOWNLINK,
      flags: 3,
      sequence: 42,
      timestampMs: 1_722_000_000_123n,
      payload: Uint8Array.from([1, 2, 3, 4]),
    });
  });

  it("rejects corrupt frames before they reach call state", () => {
    const encoded = encodeVuartFrame({
      type: VuartFrameType.HEARTBEAT,
      flags: 0,
      sequence: 1,
      timestampMs: 1n,
      payload: Uint8Array.from([7]),
    });
    encoded[encoded.length - 1] ^= 0xff;
    expect(() => decodeVuartFrame(encoded)).toThrow("crc32");
  });

  it("defines exact 20ms PCM16 mono payload sizes", () => {
    expect(pcm20msFrameBytes(8_000)).toBe(320);
    expect(pcm20msFrameBytes(16_000)).toBe(640);
  });
});
