import { describe, expect, it } from "vitest";
import {
  isLiveKitTtsAudioSupported,
  LiveKitTtsAudioSink,
  liveKitTtsTrackName,
} from "./livekit-tts-audio-sink.js";

describe("LiveKitTtsAudioSink", () => {
  it("publishes a target-role audio track and captures PCM frames", async () => {
    const rtc = createFakeRtc();
    const room = new FakeRoom();
    const sink = new LiveKitTtsAudioSink({ room, rtc, frameSizeMs: 1 });

    await sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: {
        provider: "voxcpm2",
        model: "VoxCPM2",
        audio: {
          format: "pcm16",
          sampleRate: 16000,
          data: pcm16([1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8, 9]),
        },
      },
      signal: new AbortController().signal,
    });

    expect(room.published).toMatchObject([
      {
        track: { name: liveKitTtsTrackName("guest", 16000, "guest-leg") },
        options: { source: "microphone" },
      },
    ]);
    expect(rtc.sources[0].captured.map((frame) => frame.samplesPerChannel)).toEqual([16, 1]);
    expect(Array.from(rtc.sources[0].captured[0].data.slice(0, 4))).toEqual([1, -1, 2, -2]);
    expect(rtc.sources[0].waited).toBe(1);
  });

  it("reuses the published track for the same target role and sample rate", async () => {
    const rtc = createFakeRtc();
    const room = new FakeRoom();
    const sink = new LiveKitTtsAudioSink({ room, rtc });
    const speech = {
      audio: { format: "pcm16" as const, sampleRate: 16000 as const, data: pcm16([1, 2]) },
    };

    await sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech,
      signal: new AbortController().signal,
    });
    await sink.play({
      callId: "call_1",
      segmentId: "seg_2",
      playbackId: "pb_2",
      generation: 2,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech,
      signal: new AbortController().signal,
    });

    expect(room.published).toHaveLength(1);
    expect(rtc.sources[0].captured).toHaveLength(2);
  });

  it("serializes playback on the same target audio track", async () => {
    const rtc = createFakeRtc({ captureDelayMs: 1 });
    const room = new FakeRoom();
    const sink = new LiveKitTtsAudioSink({ room, rtc, frameSizeMs: 1 });

    const first = sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: {
        audio: {
          format: "pcm16",
          sampleRate: 16000,
          data: pcm16([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 17]),
        },
      },
      signal: new AbortController().signal,
    });
    const second = sink.play({
      callId: "call_1",
      segmentId: "seg_2",
      playbackId: "pb_2",
      generation: 2,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: {
        audio: { format: "pcm16", sampleRate: 16000, data: pcm16([101]) },
      },
      signal: new AbortController().signal,
    });

    await Promise.all([first, second]);

    expect(rtc.sources[0].captured.map((frame) => frame.data[0])).toEqual([
      1,
      17,
      101,
    ]);
  });

  it("clears only the matching target leg and rejects its late frames", async () => {
    const rtc = createFakeRtc({ captureDelayMs: 5 });
    const sink = new LiveKitTtsAudioSink({ room: new FakeRoom(), rtc, frameSizeMs: 1 });
    const controller = new AbortController();
    const playback = sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: {
        audio: { format: "pcm16", sampleRate: 16000, data: pcm16(new Array(64).fill(1)) },
      },
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    const interrupted = await sink.interrupt({
      callId: "call_1",
      playbackId: "pb_1",
      generation: 1,
      targetLegId: "guest-leg",
      targetSpeakerRole: "guest",
      reason: "barge_in",
      idempotencyKey: "interrupt:pb_1:1",
    });

    await expect(playback).rejects.toThrow("interrupted");
    expect(interrupted).toEqual({ cleared: true });
    expect(rtc.sources[0].cleared).toBeGreaterThanOrEqual(1);
    const framesAfterClear = rtc.sources[0].captured.length;
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(rtc.sources[0].captured).toHaveLength(framesAfterClear);
  });

  it("reports support only when room and rtc can publish audio", () => {
    expect(isLiveKitTtsAudioSupported(new FakeRoom(), createFakeRtc())).toBe(true);
    expect(isLiveKitTtsAudioSupported({}, createFakeRtc())).toBe(false);
    expect(isLiveKitTtsAudioSupported(new FakeRoom(), {})).toBe(false);
  });
});

class FakeRoom {
  readonly published: Array<{ track: unknown; options: unknown }> = [];
  readonly localParticipant = {
    publishTrack: async (track: unknown, options: unknown) => {
      this.published.push({ track, options });
      return {};
    },
  };
}

function createFakeRtc(options: { captureDelayMs?: number } = {}) {
  const sources: FakeAudioSource[] = [];
  class FakeAudioFrame {
    constructor(
      readonly data: Int16Array,
      readonly sampleRate: number,
      readonly channels: number,
      readonly samplesPerChannel: number,
    ) {}
  }
  class FakeAudioSource {
    readonly captured: FakeAudioFrame[] = [];
    waited = 0;
    cleared = 0;

    constructor(readonly sampleRate: number, readonly channels: number) {
      sources.push(this);
    }

    async captureFrame(frame: FakeAudioFrame) {
      this.captured.push(frame);
      if (options.captureDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.captureDelayMs));
      }
    }

    async waitForPlayout() {
      this.waited += 1;
    }

    clearQueue() {
      this.cleared += 1;
    }
  }
  return {
    sources,
    AudioFrame: FakeAudioFrame,
    AudioSource: FakeAudioSource,
    LocalAudioTrack: {
      createAudioTrack: (name: string, source: FakeAudioSource) => ({ name, source }),
    },
    TrackPublishOptions: class {
      source?: unknown;
    },
    TrackSource: { SOURCE_MICROPHONE: "microphone" },
  };
}

function pcm16(samples: number[]) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer.toString("base64");
}
