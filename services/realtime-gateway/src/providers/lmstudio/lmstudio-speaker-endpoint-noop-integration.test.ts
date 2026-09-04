import { describe, expect, it } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio speaker endpoint no-op integration", () => {
  it("finalizes a no-op only after the assembled session flush", async () => {
    const resolvedNoops: number[] = [];
    const asr = endpointNoopProvider(resolvedNoops);
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: asr,
      translationClient: {
        translate: async (input) => `translated:${input.text}`,
        healthCheck: async () => true,
      },
    });
    await provider.createSession({
      sessionId: "sess_1",
      asrEndpointMode: "listening",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    await collect(provider.sendAudio(frame(1)));
    await collect(provider.sendAudio(frame(2)));
    expect(resolvedNoops).toEqual([]);
    await collect(provider.flushSession("sess_1"));

    expect(resolvedNoops).toEqual([5100]);
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerAssemblyRepair: {
        noopEvaluationCount: 1,
        noopAcceptedCount: 1,
        noopRejectionReasonCounts: {},
      },
    });
  });
});

function endpointNoopProvider(resolvedNoops: number[]): AsrProvider {
  const queue = [
    final("previous", "turn_1", "speaker_1", 0, 5000, "上一段。"),
    final("next", "turn_2", "speaker_2", 5100, 8000, "下一段。"),
  ];
  return {
    createSession: async () => undefined,
    transcribe: async () => queue.shift() ?? null,
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
    speakerBoundaryEvidence: () => ({
      boundaries: [{
        boundaryMs: 5100,
        previousSpeakerId: "speaker_1",
        nextSpeakerId: "speaker_2",
        previousTurnId: "turn_1",
        nextTurnId: "turn_2",
        confidence: 0.9,
      }],
      spans: [],
      confirmedSpeakerIds: ["speaker_1", "speaker_2"],
    }),
    resolveSpeakerBoundaries: () => undefined,
    resolveSpeakerBoundaryNoops: (_sessionId, boundaryMs) => {
      resolvedNoops.push(...boundaryMs);
    },
  };
}

function final(
  segmentId: string,
  turnId: string,
  speakerId: string,
  startMs: number,
  endMs: number,
  text: string,
) {
  const characters = Array.from(text);
  const tokenDurationMs = (endMs - startMs) / characters.length;
  return {
    segmentId,
    turnId,
    text,
    language: "zh" as const,
    endpointReason: "silence" as const,
    speaker: {
      speakerId,
      role: "speaker" as const,
      source: "diarization" as const,
    },
    timing: { startMs, endMs, source: "client" as const },
    tokenTimings: characters.map((token, index) => ({
      text: token,
      startMs: startMs + index * tokenDurationMs,
      endMs: startMs + (index + 1) * tokenDurationMs,
      characterStart: index,
      characterEnd: index + 1,
    })),
  };
}

function frame(sequence: number) {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence,
    timestampMs: sequence,
    format: "pcm16" as const,
    sampleRate: 24000 as const,
    data: "AA==",
  };
}

async function collect(events: AsyncGenerator<unknown>) {
  for await (const _event of events) {
    // Drain the provider so diagnostics and finalization complete.
  }
}
