import { describe, expect, it } from "vitest";
import {
  AudioIngestRingBuffer,
  type AudioIngestMetrics,
} from "./audio-ingest-ring-buffer.js";

describe("AudioIngestRingBuffer", () => {
  it("drops the oldest frame and reports the resulting sequence gap", async () => {
    const metrics: AudioIngestMetrics[] = [];
    const queue = new AudioIngestRingBuffer<{ sequence: number }>({
      callId: "call_1",
      legId: "guest:1",
      speakerRole: "guest",
      capacityFrames: 2,
      onMetrics: (snapshot) => metrics.push(snapshot),
    });

    queue.enqueue({ sequence: 1 });
    queue.enqueue({ sequence: 2 });
    queue.enqueue({ sequence: 3 });
    const second = await queue.dequeue();
    const third = await queue.dequeue();
    queue.markProcessed(second!);
    queue.markProcessed(third!);
    queue.close({ discardPending: false });
    queue.report("drained");

    expect([second?.sequence, third?.sequence]).toEqual([2, 3]);
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "backpressure",
      receivedFrames: 3,
      overflowDroppedFrames: 1,
      backpressureEvents: 1,
    }));
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "sequence_gap",
      sequenceGapFrames: 1,
      lastProcessedSequence: 2,
    }));
    expect(metrics.at(-1)).toMatchObject({
      event: "drained",
      processedFrames: 2,
      droppedFrames: 1,
      queueDepthFrames: 0,
    });
  });

  it("can discard a backlog after the producer has already closed", () => {
    const metrics: AudioIngestMetrics[] = [];
    const queue = new AudioIngestRingBuffer<{ sequence: number }>({
      callId: "call_1",
      legId: "host:1",
      speakerRole: "host",
      capacityFrames: 4,
      onMetrics: (snapshot) => metrics.push(snapshot),
    });
    queue.enqueue({ sequence: 1 });
    queue.enqueue({ sequence: 2 });

    queue.close({ discardPending: false });
    queue.close({ discardPending: true });

    expect(metrics.at(-1)).toMatchObject({
      event: "stopped",
      shutdownDiscardedFrames: 2,
      droppedFrames: 2,
      queueDepthFrames: 0,
    });
  });
});
