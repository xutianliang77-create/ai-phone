import { describe, expect, it } from "vitest";
import type { AudioIngestMetrics } from "./audio-ingest-ring-buffer.js";
import { CallRoomEndedError } from "./call-room-event-client.js";
import {
  CallEndedWorker,
  createFakeRtcNode,
  eventually,
  RecordingWorker,
  sourceForTest,
} from "./livekit-call-audio-source.test-support.js";

describe("LiveKitCallAudioSource ingest", () => {
  it("keeps reading RTC audio while slow ASR drops the oldest bounded backlog", async () => {
    const rtc = createFakeRtcNode({ frameCount: 5 });
    let releaseFirstFrame: (() => void) | undefined;
    const firstFrameGate = new Promise<void>((resolve) => {
      releaseFirstFrame = resolve;
    });
    const worker = new RecordingWorker(undefined, async (frame) => {
      if (frame.sequence === 1) await firstFrameGate;
    });
    const metrics: AudioIngestMetrics[] = [];
    const source = sourceForTest(rtc, worker, {
      audioIngestMaxFrames: 2,
      onIngestMetrics: (snapshot) => metrics.push(snapshot),
    });

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      { metadata: JSON.stringify({ participantRole: "guest" }) },
    );
    await eventually(() =>
      metrics.some((item) =>
        item.event === "backpressure" && item.receivedFrames === 5
      )
    );

    expect(worker.frames.map((frame) => frame.sequence)).toEqual([1]);
    const pressure = metrics.filter((item) => item.event === "backpressure").at(-1)!;
    expect(pressure).toMatchObject({
      legId: "guest:1",
      capacityFrames: 2,
      highWatermarkFrames: 2,
      receivedFrames: 5,
      droppedFrames: 2,
      overflowDroppedFrames: 2,
      backpressureEvents: 2,
    });

    releaseFirstFrame?.();
    await eventually(() => worker.frames.length === 3);
    await source.stop();

    expect(worker.frames.map((frame) => frame.sequence)).toEqual([1, 4, 5]);
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "sequence_gap",
      sequenceGapFrames: 2,
      lastProcessedSequence: 4,
    }));
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "drained",
      receivedFrames: 5,
      processedFrames: 3,
      droppedFrames: 2,
      queueDepthFrames: 0,
    }));
  });

  it("treats call-ended publication as a clean terminal signal", async () => {
    const rtc = createFakeRtcNode();
    const ended: CallRoomEndedError[] = [];
    const metrics: AudioIngestMetrics[] = [];
    const worker = new CallEndedWorker();
    const source = sourceForTest(rtc, worker, {
      onCallEnded: (error) => ended.push(error),
      onIngestMetrics: (snapshot) => metrics.push(snapshot),
    });

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      { metadata: JSON.stringify({ participantRole: "guest" }) },
    );
    await source.waitUntilDisconnected();
    await expect(Promise.all([source.stop(), source.stop()])).resolves.toBeDefined();

    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      code: "call_room_ended",
      callId: "call_1",
    });
    expect(worker.endAttempts).toBe(1);
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "stopped",
      receivedFrames: 1,
      dequeuedFrames: 1,
      processedFrames: 0,
      failedFrames: 1,
      inFlightFrames: 0,
      droppedFrames: 0,
    }));
  });
});
