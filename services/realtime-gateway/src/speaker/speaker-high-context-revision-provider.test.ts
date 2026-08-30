import { describe, expect, it } from "vitest";
import type {
  AudioFrame,
  ServerRealtimeEvent,
} from "@translation/contracts";
import type {
  RealtimeProvider,
  RealtimeProviderSession,
  TextSegmentInput,
} from "../providers/realtime-provider.js";
import {
  SpeakerRevisionRealtimeProvider,
} from "./speaker-revision-realtime-provider.js";
import type {
  SpeakerRevisionProvider,
  SpeakerRevisionRequest,
} from "./speaker-revision-provider.js";

describe("high-context speaker revision delivery", () => {
  it("atomically retranslates cardinality-matched children", async () => {
    const provider = createProvider(new SplitRealtimeProvider());
    await seed(provider);

    const flushed = await flush(provider);

    expect(flushed.map((event) => [event.type, "segmentId" in event
      ? event.segmentId
      : undefined])).toEqual([
      ["transcript.final", "seg_1"],
      ["translation.final", "seg_1"],
      ["transcript.final", "seg_1:speaker:1"],
      ["translation.final", "seg_1:speaker:1"],
    ]);
    expect(flushed.filter((event) => event.type === "transcript.final"))
      .toMatchObject([
        { text: "甲乙丙丁戊己", speaker: { speakerId: "speaker_1" }, revision: 4 },
        { text: "庚辛", speaker: { speakerId: "speaker_2" }, revision: 4 },
      ]);
    await expect(provider.diagnostics!("sess_1")).resolves.toMatchObject({
      speakerRevision: {
        acceptedCount: 1,
        splitParentCount: 1,
        splitChildCount: 2,
        splitRejectedCount: 0,
        cardinalityMismatchCount: 0,
      },
    });
  });

  it("emits nothing when any child translation fails", async () => {
    const base = new SplitRealtimeProvider();
    base.failTranslation = true;
    const provider = createProvider(base);
    await seed(provider);

    expect(await flush(provider)).toEqual([]);
    await expect(provider.diagnostics!("sess_1")).resolves.toMatchObject({
      speakerRevision: { acceptedCount: 0, errorCount: 1 },
    });
  });

  it("rejects speaker updates when the output loses claimed cardinality", async () => {
    const provider = new SpeakerRevisionRealtimeProvider(
      new UpdatesOnlyRealtimeProvider(),
      new HighContextRevisionProvider(),
      {
        mode: "apply",
        maxWindowMs: 25_000,
        tokenSplitEnabled: true,
      },
    );
    await provider.createSession({
      sessionId: "sess_1",
      asrEndpointMode: "listening",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });
    for (const [sequence, timestampMs] of [[1, 0], [2, 800], [3, 1_400]]) {
      for await (const _event of provider.sendAudio(frame(sequence, timestampMs))) {}
    }

    const flushed = await flush(provider);

    expect(flushed).toEqual([]);
    await expect(provider.diagnostics!("sess_1")).resolves.toMatchObject({
      speakerRevision: {
        acceptedCount: 0,
        splitParentCount: 0,
        splitChildCount: 0,
        splitRejectedCount: 1,
        cardinalityMismatchCount: 1,
      },
    });
  });
});

function createProvider(base: SplitRealtimeProvider) {
  return new SpeakerRevisionRealtimeProvider(
    base,
    new HighContextRevisionProvider(),
    {
      mode: "apply",
      maxWindowMs: 25_000,
      tokenSplitEnabled: true,
    },
  );
}

async function seed(provider: RealtimeProvider) {
  await provider.createSession({
    sessionId: "sess_1",
    asrEndpointMode: "listening",
    sourceLanguage: "zh",
    targetLanguage: "en",
    voiceOutput: false,
  });
  for await (const _event of provider.sendAudio(frame(1, 0))) {}
  for await (const _event of provider.sendAudio(frame(2, 1_000))) {}
}

async function flush(provider: RealtimeProvider) {
  const events: ServerRealtimeEvent[] = [];
  for await (const event of provider.flushSession!("sess_1")) {
    events.push(event);
  }
  return events;
}

class SplitRealtimeProvider implements RealtimeProvider {
  readonly name = "split-fake";
  failTranslation = false;

  async createSession(_session: RealtimeProviderSession) {}

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    if (frame.sequence === 1) {
      yield {
        type: "transcript.final",
        sessionId: frame.sessionId,
        segmentId: "seg_1",
        turnId: "turn_1",
        revision: 3,
        text: "甲乙丙丁戊己庚",
        rawText: "甲乙丙丁戊己庚辛",
        language: "zh",
        speaker: diarized("speaker_1"),
        timing: { startMs: 0, endMs: 800, source: "model" },
        rawTokenTimings: tokenTimings("甲乙丙丁戊己庚辛", 0),
      };
      return;
    }
    yield {
      type: "transcript.final",
      sessionId: frame.sessionId,
      segmentId: "seg_2",
      turnId: "turn_2",
      revision: 2,
      text: "戊己",
      language: "zh",
      speaker: diarized("speaker_2"),
      timing: { startMs: 800, endMs: 2_000, source: "model" },
      tokenTimings: tokenTimings("壬癸", 800),
    };
  }

  async *sendText(
    segment: TextSegmentInput,
  ): AsyncGenerator<ServerRealtimeEvent> {
    yield {
      type: "transcript.final",
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      revision: segment.revision,
      text: segment.text,
      language: segment.language,
      speaker: segment.speaker,
      timing: segment.timing,
      tokenTimings: segment.tokenTimings,
    };
    if (this.failTranslation && segment.segmentId.endsWith(":speaker:1")) {
      yield {
        type: "translation.failed",
        sessionId: segment.sessionId,
        segmentId: segment.segmentId,
        language: "en",
        message: "Translation unavailable",
      };
      return;
    }
    yield {
      type: "translation.final",
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      revision: segment.revision,
      text: `translated:${segment.text}`,
      language: "en",
      speaker: segment.speaker,
      timing: segment.timing,
    };
  }

  async *flushSession(_sessionId: string) {}
  async closeSession(_sessionId: string) {}
  async healthCheck() { return true; }
}

class UpdatesOnlyRealtimeProvider implements RealtimeProvider {
  readonly name = "updates-only-fake";

  async createSession(_session: RealtimeProviderSession) {}

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    const segments = [
      {
        segmentId: "seg_1",
        turnId: "turn_1",
        text: "无法安全切分的父段",
        speakerId: "speaker_1",
        startMs: 0,
        endMs: 800,
      },
      {
        segmentId: "seg_2",
        turnId: "turn_2",
        text: "需要修正说话人",
        speakerId: "speaker_1",
        startMs: 800,
        endMs: 1_400,
      },
      {
        segmentId: "seg_3",
        turnId: "turn_3",
        text: "已有第二位说话人",
        speakerId: "speaker_2",
        startMs: 1_400,
        endMs: 2_000,
      },
    ];
    const segment = segments[frame.sequence - 1];
    if (!segment) return;
    yield {
      type: "transcript.final",
      sessionId: frame.sessionId,
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      revision: 1,
      text: segment.text,
      rawText: segment.text,
      language: "zh",
      speaker: diarized(segment.speakerId),
      timing: {
        startMs: segment.startMs,
        endMs: segment.endMs,
        source: "model",
      },
    };
  }

  async *flushSession(_sessionId: string) {}
  async closeSession(_sessionId: string) {}
  async healthCheck() { return true; }
}

class HighContextRevisionProvider implements SpeakerRevisionProvider {
  async revise(request: SpeakerRevisionRequest) {
    return {
      sessionId: request.sessionId,
      generation: request.generation,
      windowStartMs: request.windowStartMs,
      windowEndMs: request.windowEndMs,
      provider: "sortformer_high_context",
      model: "diar_streaming_sortformer_4spk-v2.1",
      speakerCount: 2,
      spans: [
        { speakerId: "S01", startMs: 0, endMs: 600, confidence: 0.9 },
        { speakerId: "S02", startMs: 600, endMs: 2_000, confidence: 0.9 },
      ],
    };
  }

  async healthCheck() { return true; }
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

function diarized(speakerId: string) {
  return { speakerId, role: "speaker" as const, source: "diarization" as const };
}

function tokenTimings(text: string, startMs: number) {
  return Array.from(text).map((value, index) => ({
    text: value,
    startMs: startMs + index * 100,
    endMs: startMs + (index + 1) * 100,
    characterStart: index,
    characterEnd: index + 1,
  }));
}
