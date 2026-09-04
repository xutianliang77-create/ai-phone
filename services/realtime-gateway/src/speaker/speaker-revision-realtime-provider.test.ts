import { describe, expect, it } from "vitest";
import type {
  AudioFrame,
  ServerRealtimeEvent,
} from "@translation/contracts";
import type {
  RealtimeProvider,
  RealtimeProviderSession,
} from "../providers/realtime-provider.js";
import {
  SpeakerRevisionRealtimeProvider,
} from "./speaker-revision-realtime-provider.js";
import type {
  SpeakerRevisionProvider,
  SpeakerRevisionRequest,
} from "./speaker-revision-provider.js";

describe("speaker revision realtime provider", () => {
  it("applies speaker-only updates after the underlying final flush", async () => {
    const revision = new FakeRevisionProvider();
    const provider = new SpeakerRevisionRealtimeProvider(
      new FakeRealtimeProvider(),
      revision,
      { mode: "apply", maxWindowMs: 25_000 },
    );
    await provider.createSession(session("listening"));

    const live = [];
    for await (const event of provider.sendAudio(frame(1, 0))) live.push(event);
    for await (const event of provider.sendAudio(frame(2, 1000))) live.push(event);
    const flushed = [];
    for await (const event of provider.flushSession!("sess_1")) {
      flushed.push(event);
    }

    expect(live.map((event) => event.type)).toEqual([
      "transcript.final",
      "transcript.final",
    ]);
    expect(revision.requests).toHaveLength(1);
    expect(flushed).toEqual([
      expect.objectContaining({
        type: "speaker.updated",
        segmentId: "seg_2",
        speakerRevision: 1,
        speaker: expect.objectContaining({ speakerId: "speaker_2" }),
      }),
    ]);
    expect(live[1]).toMatchObject({
      text: "second speaker text",
      revision: 3,
    });
    await expect(provider.diagnostics!("sess_1")).resolves.toMatchObject({
      speakerRevision: {
        configuredProvider: "http",
        mode: "apply",
        requestCount: 1,
        completedCount: 1,
        acceptedCount: 1,
        emittedUpdateCount: 1,
        errorCount: 0,
      },
    });
  });

  it("runs shadow revision without emitting an update", async () => {
    const revision = new FakeRevisionProvider();
    const provider = new SpeakerRevisionRealtimeProvider(
      new FakeRealtimeProvider(),
      revision,
      { mode: "shadow", maxWindowMs: 25_000 },
    );
    await provider.createSession(session("listening"));
    for await (const _event of provider.sendAudio(frame(1, 0))) {
      // Record the underlying segment.
    }
    for await (const _event of provider.sendAudio(frame(2, 1000))) {
      // Complete the bounded two-second revision window.
    }
    const flushed = [];
    for await (const event of provider.flushSession!("sess_1")) {
      flushed.push(event);
    }

    expect(revision.requests).toHaveLength(1);
    expect(flushed).toEqual([]);
  });

  it("does not let a late translation roll back speaker evidence", async () => {
    const provider = new SpeakerRevisionRealtimeProvider(
      new LateTranslationRealtimeProvider(),
      new FakeRevisionProvider(),
      { mode: "apply", maxWindowMs: 25_000 },
    );
    await provider.createSession(session("listening"));
    for await (const _event of provider.sendAudio(frame(1, 0))) {
      // Record the corrected first speaker and a late translated copy.
    }
    for await (const _event of provider.sendAudio(frame(2, 1000))) {
      // Record the second segment.
    }
    const flushed = [];
    for await (const event of provider.flushSession!("sess_1")) {
      flushed.push(event);
    }

    expect(flushed).toEqual([
      expect.objectContaining({
        type: "speaker.updated",
        segmentId: "seg_2",
        speaker: expect.objectContaining({ speakerId: "speaker_1" }),
      }),
    ]);
  });

  it("keeps non-listening sessions and revision failures fail-open", async () => {
    const revision = new FakeRevisionProvider();
    revision.fail = true;
    const provider = new SpeakerRevisionRealtimeProvider(
      new FakeRealtimeProvider(),
      revision,
      { mode: "apply", maxWindowMs: 25_000 },
    );
    await provider.createSession(session("conversation"));
    for await (const _event of provider.sendAudio(frame(1, 0))) {
      // Record the underlying segment.
    }
    const flushed = [];
    for await (const event of provider.flushSession!("sess_1")) {
      flushed.push(event);
    }

    expect(revision.requests).toEqual([]);
    expect(flushed).toEqual([]);
    expect(await provider.healthCheck()).toBe(false);
  });

});

class FakeRealtimeProvider implements RealtimeProvider {
  readonly name = "fake";

  async createSession(_session: RealtimeProviderSession) {}

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    const second = frame.sequence === 2;
    yield {
      type: "transcript.final",
      sessionId: frame.sessionId,
      segmentId: second ? "seg_2" : "seg_1",
      turnId: second ? "turn_2" : "turn_1",
      revision: 3,
      text: second ? "second speaker text" : "first speaker text",
      language: "en",
      speaker: {
        speakerId: "speaker_1",
        role: "speaker",
        source: "diarization",
      },
      timing: {
        startMs: second ? 1_000 : 0,
        endMs: second ? 2_000 : 1_000,
        source: "client",
      },
    };
  }

  async *flushSession(_sessionId: string) {}
  async closeSession(_sessionId: string) {}
  async healthCheck() { return true; }
}

class LateTranslationRealtimeProvider extends FakeRealtimeProvider {
  override async *sendAudio(
    frame: AudioFrame,
  ): AsyncGenerator<ServerRealtimeEvent> {
    if (frame.sequence === 1) {
      yield transcript(frame.sessionId, "seg_1", "speaker_1", 0, 1_000);
      yield {
        type: "speaker.updated",
        sessionId: frame.sessionId,
        segmentId: "seg_1",
        speakerRevision: 1,
        speaker: {
          speakerId: "speaker_2",
          role: "speaker",
          source: "diarization",
        },
      };
      yield {
        ...transcript(frame.sessionId, "seg_1", "speaker_1", 0, 1_000),
        type: "translation.final",
        text: "迟到的翻译",
        language: "zh",
      };
      return;
    }
    yield transcript(frame.sessionId, "seg_2", "speaker_2", 1_000, 2_000);
  }
}

class FakeRevisionProvider implements SpeakerRevisionProvider {
  requests: SpeakerRevisionRequest[] = [];
  fail = false;

  async revise(request: SpeakerRevisionRequest) {
    this.requests.push(request);
    if (this.fail) throw new Error("revision unavailable");
    return {
      sessionId: request.sessionId,
      generation: request.generation,
      windowStartMs: request.windowStartMs,
      windowEndMs: request.windowEndMs,
      provider: "fake_revision",
      speakerCount: 2,
      spans: [
        { speakerId: "S01", startMs: 0, endMs: 900 },
        { speakerId: "S02", startMs: 1_000, endMs: 2_000 },
      ],
    };
  }

  async healthCheck() { return !this.fail; }
}

function session(
  asrEndpointMode: "listening" | "conversation",
): RealtimeProviderSession {
  return {
    sessionId: "sess_1",
    asrEndpointMode,
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
  };
}

function frame(sequence: number, timestampMs: number): AudioFrame {
  return {
    type: "audio.frame",
    sessionId: "sess_1",
    sequence,
    timestampMs,
    format: "pcm16",
    sampleRate: 16_000,
    data: Buffer.alloc(32_000).toString("base64"),
  };
}

function transcript(
  sessionId: string,
  segmentId: string,
  speakerId: string,
  startMs: number,
  endMs: number,
): ServerRealtimeEvent {
  return {
    type: "transcript.final",
    sessionId,
    segmentId,
    revision: 3,
    text: segmentId,
    language: "en",
    speaker: { speakerId, role: "speaker", source: "diarization" },
    timing: { startMs, endMs, source: "client" },
  };
}
