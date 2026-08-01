import { describe, expect, it } from "vitest";
import { LiveKitCallAudioSource } from "./livekit-call-audio-source.js";
import {
  createFakeRtcNode,
  eventually,
  RecordingWorker,
} from "./livekit-call-audio-source.test-support.js";

describe("LiveKitCallAudioSource role gate", () => {
  it("ignores a concurrent track from a second participant with the same role", async () => {
    const streams = new Map<unknown, ReadableStreamDefaultController<{
      data: Int16Array;
      sampleRate: number;
    }>>();
    const rtc = createFakeRtcNode({
      audioStreamForTrack: (track) => new ReadableStream({
        start(controller) {
          streams.set(track, controller);
          controller.enqueue({
            data: new Int16Array([1, -1]),
            sampleRate: 24000,
          });
        },
      }),
    });
    const worker = new RecordingWorker();
    const lifecycle: Array<{ event: string; outcome: string }> = [];
    const source = new LiveKitCallAudioSource({
      callId: "call_1",
      worker: worker as never,
      audioSampleRate: 24000,
      audioFrameSizeMs: 100,
      onTrackLifecycle: (event) => lifecycle.push(event),
    });
    await source.startInRoom({
      room: rtc.room as never,
      rtc: rtc.module,
      participantIdentity: "call_1:worker:one",
    });
    const firstTrack = new rtc.RemoteAudioTrack();
    const duplicateTrack = new rtc.RemoteAudioTrack();
    rtc.room.emit(
      "trackSubscribed",
      firstTrack,
      {},
      participant("call_1:guest:first"),
    );
    await eventually(() => worker.frames.length === 1);
    rtc.room.emit(
      "trackSubscribed",
      duplicateTrack,
      {},
      participant("call_1:guest:duplicate"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();

    expect(streams.has(firstTrack)).toBe(true);
    expect(streams.has(duplicateTrack)).toBe(false);
    expect(worker.frames).toHaveLength(1);
    expect(lifecycle).toContainEqual({
      event: "track_subscribed",
      speakerRole: "guest",
      outcome: "ignored_duplicate_role",
    });
  });
});

function participant(identity: string) {
  return {
    identity,
    metadata: JSON.stringify({ participantRole: "guest" }),
  };
}
