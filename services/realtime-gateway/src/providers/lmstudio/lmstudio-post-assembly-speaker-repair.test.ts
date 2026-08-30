import { describe, expect, it } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio post-assembly speaker repair", () => {
  it("splits a max-duration continuation before translation", async () => {
    const { asr, resolvedBoundaryMs } = boundaryContinuationProvider();
    const translated: string[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: asr,
      translationClient: {
        translate: async (input) => {
          translated.push(input.text);
          return `translated:${input.text}`;
        },
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

    expect(await audioEvents(provider, 1)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    const events = [];
    for await (const event of provider.sendAudio(audioFrame(2))) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "transcript.final",
      "translation.final",
      "transcript.final",
      "translation.final",
    ]);
    expect(events[1]).toMatchObject({
      segmentId: "boundary_parent",
      turnId: "turn_1",
      speaker: { speakerId: "speaker_1" },
      timing: { startMs: 0, endMs: 6001, overlap: false },
    });
    expect(events[3]).toMatchObject({
      segmentId: "boundary_parent:speaker:1",
      turnId: "turn_2",
      speaker: { speakerId: "speaker_2" },
      timing: { startMs: 6001, endMs: 11600, overlap: false },
    });
    expect(resolvedBoundaryMs).toEqual([6001]);
    expect(translated.slice(1)).toEqual([events[1].text, events[3].text]);
  });
});

function boundaryContinuationProvider() {
  const resolvedBoundaryMs: number[] = [];
  const speaker = {
    speakerId: "speaker_1",
    role: "speaker" as const,
    source: "diarization" as const,
  };
  const queue = [
    {
      segmentId: "boundary_parent",
      turnId: "turn_1",
      revision: 1,
      text: "甲方先说明方案。",
      language: "zh" as const,
      endpointReason: "max_duration" as const,
      speaker,
      timing: { startMs: 0, endMs: 6000, source: "client" as const },
      tokenTimings: characterTimings("甲方先说明方案。", 0, 830),
    },
    {
      segmentId: "boundary_tail",
      turnId: "turn_1",
      revision: 2,
      text: "乙方随后确认执行。",
      language: "zh" as const,
      endpointReason: "silence" as const,
      speaker,
      timing: { startMs: 6001, endMs: 11600, source: "client" as const },
      tokenTimings: characterTimings("乙方随后确认执行。", 6001, 500),
    },
  ];
  const asr: AsrProvider = {
    createSession: async () => undefined,
    transcribe: async () => queue.shift() ?? null,
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
    speakerBoundaryEvidence: () => ({
      boundaries: [{
        boundaryMs: 6001,
        previousSpeakerId: "speaker_1",
        nextSpeakerId: "speaker_2",
        previousTurnId: "turn_1",
        nextTurnId: "turn_2",
        confidence: 0.9,
      }],
      spans: [
        {
          speakerId: "speaker_1",
          startMs: 0,
          endMs: 6001,
          confidence: 0.95,
        },
        {
          speakerId: "speaker_2",
          startMs: 6001,
          endMs: 11600,
          confidence: 0.95,
        },
      ],
      confirmedSpeakerIds: ["speaker_1", "speaker_2"],
    }),
    resolveSpeakerBoundaries: (_sessionId, boundaryMs) => {
      resolvedBoundaryMs.push(...boundaryMs);
    },
  };
  return { asr, resolvedBoundaryMs };
}

function characterTimings(text: string, startMs: number, stepMs: number) {
  return Array.from(text).flatMap((character, index) =>
    /[，。,.]/u.test(character)
      ? []
      : [{
          text: character,
          startMs: startMs + index * stepMs,
          endMs: startMs + (index + 1) * stepMs,
          characterStart: index,
          characterEnd: index + 1,
        }]
  );
}

async function audioEvents(
  provider: LmStudioRealtimeProvider,
  sequence: number,
) {
  const events = [];
  for await (const event of provider.sendAudio(audioFrame(sequence))) {
    events.push(event.type);
  }
  return events;
}

function audioFrame(sequence: number) {
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
