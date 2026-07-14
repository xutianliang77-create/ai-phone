import { describe, expect, it } from "vitest";
import { CallTtsPlaybackQueue, type PlaybackStartedInput } from "./call-tts-playback-queue.js";
import type { CallTtsAudioSink } from "./types.js";

describe("CallTtsPlaybackQueue", () => {
  it("serializes one target leg and increases its generation", async () => {
    const firstRelease = deferred<void>();
    const firstStarted = deferred<void>();
    const played: Parameters<CallTtsAudioSink["play"]>[0][] = [];
    const lifecycle: string[] = [];
    const queue = new CallTtsPlaybackQueue(
      async () => undefined,
      undefined,
      async (state, input) => {
        lifecycle.push(`${input.playbackId}:${state}`);
      },
    );
    queue.addSink({
      async play(input) {
        played.push(input);
        if (input.generation === 1) {
          firstStarted.resolve();
          await firstRelease.promise;
        }
      },
    });

    queue.enqueue(playback("segment-1", "host"));
    queue.enqueue(playback("segment-2", "host"));
    await firstStarted.promise;
    expect(played).toHaveLength(1);
    firstRelease.resolve();
    await queue.drain("call-1");

    expect(played.map(({ playbackId, generation }) => ({ playbackId, generation })))
      .toEqual([
        { playbackId: "pb_segment-1_1", generation: 1 },
        { playbackId: "pb_segment-2_2", generation: 2 },
      ]);
    expect(lifecycle).toEqual([
      "pb_segment-1_1:queued",
      "pb_segment-1_1:started",
      "pb_segment-1_1:ended",
      "pb_segment-2_2:queued",
      "pb_segment-2_2:started",
      "pb_segment-2_2:ended",
    ]);
  });

  it("allows opposite target legs to play independently", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const targets: string[] = [];
    let startedCount = 0;
    const queue = new CallTtsPlaybackQueue(async () => undefined);
    queue.addSink({
      async play(input) {
        targets.push(input.targetSpeakerRole);
        startedCount += 1;
        if (startedCount === 2) started.resolve();
        await release.promise;
      },
    });

    queue.enqueue(playback("host-segment", "host"));
    queue.enqueue(playback("guest-segment", "guest"));
    await started.promise;
    expect(targets.sort()).toEqual(["guest", "host"]);
    release.resolve();
    await queue.drain("call-1");
  });

  it("binds playback to persisted legs and clears only that target", async () => {
    const started = deferred<void>();
    const sinkRelease = deferred<void>();
    const lifecycle: string[] = [];
    const interrupts: string[] = [];
    const queue = new CallTtsPlaybackQueue(
      async () => undefined,
      undefined,
      async (state, input) => {
        lifecycle.push(`${state}:${input.targetLegId ?? "unbound"}`);
        if (state === "queued") {
          return {
            playbackId: input.playbackId,
            generation: input.generation,
            sourceLegId: "host-leg",
            targetLegId: "guest-leg",
          };
        }
      },
    );
    queue.addSink({
      capabilities: {
        bidirectionalMedia: true,
        streamingWrite: true,
        clearPlayback: true,
      },
      async play(input) {
        started.resolve();
        await sinkRelease.promise;
        if (input.signal.aborted) throw new Error("interrupted");
      },
      async interrupt(input) {
        interrupts.push(`${input.targetLegId}:${input.generation}`);
        sinkRelease.resolve();
        return { cleared: true };
      },
    });

    queue.enqueue(playback("segment-1", "host"));
    await started.promise;
    const result = await queue.interruptTarget({
      callId: "call-1",
      targetLegId: "guest-leg",
      reason: "barge_in",
    });
    await queue.drain("call-1");

    expect(result).toMatchObject({
      supported: true,
      interrupted: true,
      cleared: true,
      playback: { playbackId: "pb_segment-1_1" },
    });
    expect(interrupts).toEqual(["guest-leg:1"]);
    expect(lifecycle).toEqual([
      "queued:unbound",
      "started:guest-leg",
      "interrupted:guest-leg",
    ]);
  });

  it("invalidates queued audio for the interrupted target only", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const played: string[] = [];
    const queue = new CallTtsPlaybackQueue(async () => undefined);
    queue.addSink({
      capabilities: {
        bidirectionalMedia: true,
        streamingWrite: true,
        clearPlayback: true,
      },
      async play(input) {
        played.push(input.segmentId);
        if (input.segmentId === "segment-1") {
          started.resolve();
          await release.promise;
        }
      },
      async interrupt() {
        release.resolve();
        return { cleared: true };
      },
    });

    queue.enqueue(playback("segment-1", "host"));
    queue.enqueue(playback("segment-2", "host"));
    queue.enqueue(playback("opposite", "guest"));
    await started.promise;
    await queue.interruptSpeaker({
      callId: "call-1",
      targetSpeakerRole: "guest",
      reason: "barge_in",
    });
    await queue.drain("call-1");

    expect(played).toContain("segment-1");
    expect(played).toContain("opposite");
    expect(played).not.toContain("segment-2");
  });
});

function playback(
  segmentId: string,
  speakerRole: PlaybackStartedInput["speakerRole"],
) {
  return {
    callId: "call-1",
    segmentId,
    speakerRole,
    targetLanguage: speakerRole === "host" ? "en" as const : "zh" as const,
    translatedText: `translation-${segmentId}`,
    speech: {
      provider: "voxcpm2",
      model: "VoxCPM2",
      audio: { format: "pcm16" as const, sampleRate: 24000 as const, data: "AAE=" },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
