import { describe, expect, it } from "vitest";
import {
  BoundedDeviceAudioQueue,
  rechunkDevicePcm,
} from "./device-audio-queue.js";

const devicePayload = (seed = 0) => Uint8Array.from(
  { length: 6_400 },
  (_, index) => (index + seed) % 256,
);

describe("Air device PCM rechunker", () => {
  it("losslessly splits one 200ms device chunk into ten 20ms frames", () => {
    const payload = devicePayload();
    const frames = rechunkDevicePcm({
      payload,
      deviceSequence: 42,
      callGeneration: 7,
    });

    expect(frames).toHaveLength(10);
    expect(frames.map((frame) => ({
      bytes: frame.payload.byteLength,
      deviceSequence: frame.deviceSequence,
      subframeIndex: frame.subframeIndex,
      callGeneration: frame.callGeneration,
    }))).toEqual(Array.from({ length: 10 }, (_, subframeIndex) => ({
      bytes: 640,
      deviceSequence: 42,
      subframeIndex,
      callGeneration: 7,
    })));
    expect(Uint8Array.from(frames.flatMap((frame) => [...frame.payload])))
      .toEqual(payload);
  });

  it.each([6_399, 6_401])("rejects an invalid %i-byte device chunk", (length) => {
    expect(() => rechunkDevicePcm({
      payload: new Uint8Array(length),
      deviceSequence: 1,
      callGeneration: 1,
    })).toThrow("6400");
  });
});

describe("bounded Air device audio queue", () => {
  it("observes gaps, duplicates, out-of-order chunks and backpressure", () => {
    const queue = new BoundedDeviceAudioQueue(20);
    queue.beginGeneration(3);

    expect(queue.enqueue({
      payload: devicePayload(1),
      deviceSequence: 10,
      callGeneration: 3,
    })).toEqual({ accepted: true, framesEnqueued: 10 });
    expect(queue.enqueue({
      payload: devicePayload(2),
      deviceSequence: 10,
      callGeneration: 3,
    })).toEqual({ accepted: false, reason: "duplicate" });
    expect(queue.enqueue({
      payload: devicePayload(3),
      deviceSequence: 9,
      callGeneration: 3,
    })).toEqual({ accepted: false, reason: "out_of_order" });
    expect(queue.enqueue({
      payload: devicePayload(4),
      deviceSequence: 12,
      callGeneration: 3,
    })).toEqual({ accepted: true, framesEnqueued: 10 });
    expect(queue.enqueue({
      payload: devicePayload(5),
      deviceSequence: 13,
      callGeneration: 3,
    })).toEqual({ accepted: false, reason: "backpressure" });

    expect(queue.size()).toBe(20);
    expect(queue.metrics()).toMatchObject({
      acceptedChunks: 2,
      sequenceGapEvents: 1,
      missingDeviceChunks: 1,
      duplicateChunks: 1,
      outOfOrderChunks: 1,
      backpressureEvents: 1,
      droppedChunks: 1,
      droppedFrames: 10,
    });
  });

  it("clears queued frames and rejects old generations after reconnect or end", () => {
    const queue = new BoundedDeviceAudioQueue(20);
    queue.beginGeneration(4);
    queue.enqueue({
      payload: devicePayload(1),
      deviceSequence: 1,
      callGeneration: 4,
    });

    queue.beginGeneration(5);
    expect(queue.size()).toBe(0);
    expect(queue.enqueue({
      payload: devicePayload(2),
      deviceSequence: 2,
      callGeneration: 4,
    })).toEqual({ accepted: false, reason: "stale_generation" });
    expect(queue.enqueue({
      payload: devicePayload(3),
      deviceSequence: 1,
      callGeneration: 5,
    })).toEqual({ accepted: true, framesEnqueued: 10 });

    queue.endGeneration(5);
    expect(queue.size()).toBe(0);
    expect(queue.enqueue({
      payload: devicePayload(4),
      deviceSequence: 2,
      callGeneration: 5,
    })).toEqual({ accepted: false, reason: "stale_generation" });
    expect(queue.metrics()).toMatchObject({
      staleGenerationChunks: 2,
      clearedFrames: 20,
    });
  });

  it("restores only the retired latest generation after a transport reset", () => {
    const queue = new BoundedDeviceAudioQueue(20);
    queue.beginGeneration(7);
    queue.enqueue({
      payload: devicePayload(1),
      deviceSequence: 9,
      callGeneration: 7,
    });
    queue.endGeneration(7);

    queue.restoreGeneration(7);
    expect(queue.enqueue({
      payload: devicePayload(2),
      deviceSequence: 1,
      callGeneration: 7,
    })).toEqual({ accepted: true, framesEnqueued: 10 });
    expect(() => queue.restoreGeneration(7)).toThrow("is active");
    queue.endGeneration(7);
    expect(() => queue.restoreGeneration(6)).toThrow("latest");
  });
});
