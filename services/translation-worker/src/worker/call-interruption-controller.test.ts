import { describe, expect, it } from "vitest";
import type { CallRoomSubmittedEvent } from "@translation/contracts";
import { CallInterruptionController } from "./call-interruption-controller.js";
import { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
import type {
  CallRoomEventSink,
  CallTtsAudioSink,
  CallVadDecision,
} from "./types.js";

describe("CallInterruptionController", () => {
  it("interrupts only the playback targeted to the speaking participant", async () => {
    const harness = createHarness();
    harness.queue.enqueue(playback("to-guest", "host"));
    harness.queue.enqueue(playback("to-host", "guest"));
    await harness.bothStarted.promise;

    harness.observeSpeech("guest");
    await harness.confirmed.promise;

    expect(harness.interruptedTargets).toEqual(["guest-leg"]);
    expect(harness.events.map((event) => event.type)).toContain("barge_in.detected");
    expect(harness.events).toContainEqual(expect.objectContaining({
      type: "barge_in.confirmed",
      targetLegId: "guest-leg",
      speakerRole: "guest",
      speechDurationMs: 300,
      preRollMs: 400,
    }));
    harness.releaseAll();
    await harness.queue.drain("call-1");
  });

  it("requires consecutive valid MarbleNet speech", async () => {
    const harness = createHarness();
    harness.queue.enqueue(playback("to-guest", "host"));
    await harness.firstStarted.promise;

    harness.controller.observe(decision(1, "guest", true));
    harness.controller.observe(decision(2, "guest", false));
    harness.controller.observe(decision(3, "guest", true));
    harness.controller.observe(decision(4, "guest", true));
    await Promise.resolve();
    expect(harness.interruptedTargets).toEqual([]);

    harness.controller.observe(decision(5, "guest", true));
    await harness.confirmed.promise;
    expect(harness.interruptedTargets).toEqual(["guest-leg"]);
    harness.releaseAll();
    await harness.queue.drain("call-1");
  });

  it("fails closed and publishes degradation when VAD falls back", async () => {
    const events: CallRoomSubmittedEvent[] = [];
    const published = deferred<void>();
    const controller = new CallInterruptionController({
      config: config(),
      playbackQueue: new CallTtsPlaybackQueue(async () => undefined),
      eventSink: {
        async publish(_callId, batch) {
          events.push(...batch);
          published.resolve();
        },
      },
      nowMs: () => 1000,
    });

    controller.observe({
      ...decision(1, "host", true),
      provider: "rms_fallback",
      fallback: true,
    });
    await published.promise;

    expect(events).toContainEqual(expect.objectContaining({
      type: "pipeline.degraded",
      degradationReason: "vad_fallback",
      duplexMode: "half_duplex",
    }));
  });

  it("degrades instead of aborting when playback clear is unsupported", async () => {
    const harness = createHarness({ interruptible: false });
    harness.queue.enqueue(playback("to-guest", "host"));
    await harness.firstStarted.promise;

    harness.observeSpeech("guest");
    await harness.degraded.promise;

    expect(harness.interruptedTargets).toEqual([]);
    expect(harness.events).toContainEqual(expect.objectContaining({
      type: "pipeline.degraded",
      degradationReason: "playback_clear_unsupported",
    }));
    harness.releaseAll();
    await harness.queue.drain("call-1");
  });
});

function createHarness(options: { interruptible?: boolean } = {}) {
  const interruptible = options.interruptible ?? true;
  const firstStarted = deferred<void>();
  const bothStarted = deferred<void>();
  const confirmed = deferred<void>();
  const degraded = deferred<void>();
  const releases = new Map<string, ReturnType<typeof deferred<void>>>();
  const events: CallRoomSubmittedEvent[] = [];
  const interruptedTargets: string[] = [];
  let startedCount = 0;
  const eventSink: CallRoomEventSink = {
    async publish(_callId, batch) {
      events.push(...batch);
      if (batch.some((event) => event.type === "barge_in.confirmed")) {
        confirmed.resolve();
      }
      if (batch.some((event) => event.type === "pipeline.degraded")) {
        degraded.resolve();
      }
    },
  };
  const queue = new CallTtsPlaybackQueue(
    async () => undefined,
    undefined,
    async (state, input) => {
      if (state !== "queued") return;
      return {
        playbackId: input.playbackId,
        generation: input.generation,
        sourceLegId: `${input.speakerRole}-leg`,
        targetLegId: `${input.targetSpeakerRole}-leg`,
      };
    },
  );
  const sink: CallTtsAudioSink = {
    capabilities: interruptible
      ? { bidirectionalMedia: true, streamingWrite: true, clearPlayback: true }
      : undefined,
    async play(input) {
      const release = deferred<void>();
      releases.set(input.targetLegId, release);
      startedCount += 1;
      firstStarted.resolve();
      if (startedCount === 2) bothStarted.resolve();
      await release.promise;
    },
    ...(interruptible
      ? {
          async interrupt(input) {
            interruptedTargets.push(input.targetLegId);
            releases.get(input.targetLegId)?.resolve();
            return { cleared: true };
          },
        }
      : {}),
  };
  queue.addSink(sink);
  const controller = new CallInterruptionController({
    config: config(),
    playbackQueue: queue,
    eventSink,
    nowMs: () => 1000,
  });
  return {
    queue,
    controller,
    events,
    interruptedTargets,
    firstStarted,
    bothStarted,
    confirmed,
    degraded,
    observeSpeech(role: "host" | "guest") {
      controller.observe(decision(1, role, true));
      controller.observe(decision(2, role, true));
      controller.observe(decision(3, role, true));
    },
    releaseAll() {
      for (const release of releases.values()) release.resolve();
    },
  };
}

function decision(
  sequence: number,
  speakerRole: "host" | "guest",
  voiced: boolean,
): CallVadDecision {
  return {
    callId: "call-1",
    speakerRole,
    sequence,
    timestampMs: sequence * 100,
    durationMs: 100,
    voiced,
    probability: voiced ? 0.8 : 0.1,
    provider: "marblenet",
    fallback: false,
    preRollMs: 400,
  };
}

function playback(segmentId: string, speakerRole: "host" | "guest") {
  return {
    callId: "call-1",
    segmentId,
    speakerRole,
    targetLanguage: speakerRole === "host" ? "en" as const : "zh" as const,
    translatedText: segmentId,
    speech: {
      audio: {
        format: "pcm16" as const,
        sampleRate: 24000 as const,
        data: "AAE=",
      },
    },
  };
}

function config() {
  return {
    enabled: true,
    minSpeechMs: 240,
    minProbability: 0.5,
    cooldownMs: 800,
    preRollMs: 400,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
