import { describe, expect, it } from "vitest";
import type { AudioIngestMetrics } from "./audio-ingest-ring-buffer.js";
import type { LiveKitCallDiagnosticsSnapshot } from
  "./livekit-call-audio-source-types.js";
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
    const diagnostics: LiveKitCallDiagnosticsSnapshot[] = [];
    const source = sourceForTest(rtc, worker, {
      audioIngestMaxFrames: 2,
      onIngestMetrics: (snapshot) => metrics.push(snapshot),
      onDiagnostics: (snapshot) => diagnostics.push(snapshot),
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
    expect(diagnostics).toEqual([expect.objectContaining({
      audioLegs: [expect.objectContaining({
        legId: "guest:1",
        receivedFrames: 5,
        processedFrames: 3,
        droppedFrames: 2,
        sequenceGapFrames: 2,
      })],
    })]);
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
      processedFrames: 1,
      failedFrames: 0,
      inFlightFrames: 0,
      droppedFrames: 0,
    }));
  });

  it("replaces the previous participant track after RTC reconnect", async () => {
    const first = controlledAudioStream();
    const second = controlledAudioStream();
    const streams = new Map<unknown, ReadableStream<{
      data: Int16Array;
      sampleRate: number;
    }>>();
    const rtc = createFakeRtcNode({
      audioStreamForTrack: (track) => streams.get(track)!,
    });
    const worker = new RecordingWorker();
    const lifecycle: string[] = [];
    const source = sourceForTest(rtc, worker, {
      onTrackLifecycle: (event) => lifecycle.push(event.event),
    });
    const participant = {
      identity: "guest-one",
      metadata: JSON.stringify({ participantRole: "guest" }),
    };
    const firstTrack = new rtc.RemoteAudioTrack();
    const secondTrack = new rtc.RemoteAudioTrack();
    streams.set(firstTrack, first.stream);
    streams.set(secondTrack, second.stream);

    await source.start();
    rtc.room.emit("trackSubscribed", firstTrack, {}, participant);
    first.push();
    await eventually(() => worker.frames.length === 1);
    rtc.room.emit("trackSubscribed", secondTrack, {}, participant);
    await eventually(() => lifecycle.filter((event) =>
      event === "audio_leg_started").length === 2);
    for (let index = 0; index < 3; index += 1) {
      first.push();
      second.push();
    }
    await eventually(() => worker.frames.length >= 4);
    await source.stop();

    expect(worker.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 4]);
  });
});

function controlledAudioStream() {
  let controller: ReadableStreamDefaultController<{
    data: Int16Array;
    sampleRate: number;
  }>;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
    },
  });
  return {
    stream,
    push() {
      try {
        controller.enqueue({ data: new Int16Array([1, -1]), sampleRate: 24000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}
