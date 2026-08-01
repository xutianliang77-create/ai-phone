import { describe, expect, it } from "vitest";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import {
  DelayedAsrProvider,
  FakeAsrProvider,
  FakeSpeakerProvider,
  frame,
  OneShotSpeakerProvider,
  ReturningSpeakerProvider,
  session,
  UnknownSpeakerAsrProvider,
  UpdatingSpeakerProvider,
} from "./speaker-aware-asr-provider.test-support.js";

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

  it("replaces an explicit unknown ASR speaker with diarization evidence", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new UnknownSpeakerAsrProvider(),
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

  it("reuses the original anonymous speaker when that speaker returns", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new UnknownSpeakerAsrProvider(false),
      new ReturningSpeakerProvider(),
    );
    await provider.createSession(session);

    const observed = [];
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      observed.push(await provider.transcribe({ ...frame, sequence }));
    }

    expect(observed[1]).toMatchObject({
      speaker: { speakerId: "speaker_1" },
    });
    expect(observed[3]).toMatchObject({
      speaker: { speakerId: "speaker_2" },
    });
    expect(observed[5]).toMatchObject({
      speaker: { speakerId: "speaker_1" },
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

  it("retains speaker spans produced before ASR emits a transcript", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new DelayedAsrProvider(),
      new OneShotSpeakerProvider(),
    );
    await provider.createSession(session);

    expect(await provider.transcribe(frame)).toBeNull();
    const transcript = await provider.transcribe({ ...frame, sequence: 2 });

    expect(transcript).toMatchObject({
      text: "hello",
      speaker: { speakerId: "speaker_2" },
    });
  });

  it("falls back to the stable turn speaker when no span overlaps the ASR window", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new OutOfWindowAsrProvider(),
      new ConfidentSpeakerProvider(),
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

  it("replaces a provisional speaker span with its final boundary", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new DelayedAsrProvider(),
      new UpdatingSpeakerProvider(),
    );
    await provider.createSession(session);

    expect(await provider.transcribe(frame)).toBeNull();
    const transcript = await provider.transcribe({ ...frame, sequence: 2 });

    expect(transcript).toMatchObject({
      speaker: { speakerId: "speaker_2" },
    });
  });

});

class OutOfWindowAsrProvider extends FakeAsrProvider {
  override async transcribe() {
    const transcript = await super.transcribe();
    if (!transcript || Array.isArray(transcript)) return transcript;
    return {
      ...transcript,
      timing: { startMs: 3000, endMs: 4000, source: "client" as const },
    };
  }
}

class ConfidentSpeakerProvider extends FakeSpeakerProvider {
  override async pushAudio() {
    return [{
      speakerId: "speaker_2",
      startMs: 900,
      endMs: 1900,
      confidence: 0.9,
    }];
  }
}
