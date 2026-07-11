import { describe, expect, it } from "vitest";
import type { AudioFrame } from "@translation/contracts";
import type { AsrProvider, AsrSession } from "./asr-provider.js";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import type {
  SpeakerAttributionProvider,
  SpeakerSessionInput,
} from "../speaker/speaker-attribution-provider.js";

const frame: AudioFrame = {
  type: "audio.frame",
  sessionId: "sess_1",
  sequence: 1,
  timestampMs: 1000,
  format: "pcm16",
  sampleRate: 24000,
  data: "AA==",
};

const session: AsrSession = {
  sessionId: "sess_1",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  speakerAttribution: { mode: "diarization", maxSpeakers: 2 },
};

describe("speaker aware asr provider", () => {
  it("aligns diarization spans without changing ASR text", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new FakeAsrProvider(),
      new FakeSpeakerProvider(),
    );
    await provider.createSession(session);
    const transcript = await provider.transcribe(frame);

    expect(transcript).toMatchObject({
      text: "hello",
      speaker: {
        speakerId: "speaker_2",
        role: "speaker",
        source: "diarization",
      },
    });
  });

  it("keeps ASR available when the speaker service cannot start", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new FakeAsrProvider(),
      new FakeSpeakerProvider(true),
    );
    await provider.createSession(session);

    const transcript = await provider.transcribe(frame);

    expect(transcript).toMatchObject({ text: "hello" });
    expect(transcript).not.toHaveProperty("speaker");
  });
});

class FakeAsrProvider implements AsrProvider {
  async createSession() {}
  async transcribe() {
    return {
      segmentId: "seg_1",
      text: "hello",
      language: "en" as const,
      timing: { startMs: 1000, endMs: 1800, source: "client" as const },
    };
  }
  async flush() {
    return null;
  }
  async closeSession() {}
  async healthCheck() {
    return true;
  }
}

class FakeSpeakerProvider implements SpeakerAttributionProvider {
  readonly name = "fake";
  constructor(private readonly failStart = false) {}
  async createSession(_input: SpeakerSessionInput) {
    if (this.failStart) throw new Error("speaker unavailable");
  }
  async pushAudio() {
    return [{ speakerId: "speaker_2", startMs: 900, endMs: 1900 }];
  }
  async flush() {
    return [];
  }
  async closeSession() {}
  async healthCheck() {
    return !this.failStart;
  }
}
