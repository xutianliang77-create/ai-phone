import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio realtime provider continuation", () => {
  afterEach(() => vi.useRealTimers());

  it("translates max-duration raw continuation only once", async () => {
    const translateInputs: Array<{ text: string }> = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: queuedAsrProvider(),
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "We will confirm the owner and deadline, then send it to all attendees.";
        },
        healthCheck: async () => true,
      },
    });
    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    const first = [];
    for await (const event of provider.sendAudio(audioFrame(1))) first.push(event);
    const second = [];
    for await (const event of provider.sendAudio(audioFrame(2))) second.push(event);

    expect(first.map((event) => event.type)).toEqual(["transcript.partial"]);
    expect(second.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(second[0]).toMatchObject({
      segmentId: "qwen3_seg_800",
      rawText:
        "今天下午三点我们讨论产品计划，确认负责人和截止日期，然后发送给所有参会人员。",
    });
    expect(translateInputs).toEqual([{
      text: "今天下午三点我们讨论产品计划，确认负责人和截止日期，然后发送给所有参会人员。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    }]);
  });

  it("publishes a listening max-duration provisional without waiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const provider = timeoutProvider(1200);
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
    vi.advanceTimersByTime(1199);
    expect(await audioEvents(provider, 2)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(await audioEvents(provider, 3)).toEqual([]);
  });

  it("revises the provisional id and tombstones the absorbed continuation", async () => {
    const translateInputs: Array<{ text: string }> = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      listeningMaxContinuationBufferMs: 7500,
      asrProvider: safeListeningContinuationProvider(),
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return input.text.includes("整理会议纪要")
            ? "I will organize the meeting minutes."
            : "I will...";
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

    const first = [];
    for await (const event of provider.sendAudio(audioFrame(1))) first.push(event);
    expect(first.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(first[0]).toMatchObject({
      segmentId: "qwen3_seg_418",
      revision: 6,
      text: "我会整。",
    });

    const partial = [];
    for await (const event of provider.sendAudio(audioFrame(2))) partial.push(event);
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({
      type: "transcript.partial",
      segmentId: "qwen3_seg_418",
      revision: 7,
      text: "我会整理会议纪要",
    });

    const revised = [];
    for await (const event of provider.sendAudio(audioFrame(3))) revised.push(event);
    expect(revised.map((event) => event.type)).toEqual([
      "transcript.final",
      "transcript.final",
      "translation.final",
    ]);
    expect(revised[0]).toMatchObject({
      segmentId: "qwen3_seg_478",
      text: "",
    });
    expect(revised[1]).toMatchObject({
      segmentId: "qwen3_seg_418",
      revision: 7,
      text: "我会整理会议纪要，并在下班前发给大家确认。",
    });
    expect(revised[2]).toMatchObject({
      segmentId: "qwen3_seg_418",
      revision: 7,
      text: "I will organize the meeting minutes.",
    });
    expect(translateInputs.map((input) => input.text)).toEqual([
      "我会整。",
      "我会整理会议纪要，并在下班前发给大家确认。",
    ]);
  });

  it("keeps the default continuation bound outside listening mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const provider = timeoutProvider(1200);
    await provider.createSession({
      sessionId: "sess_1",
      asrEndpointMode: "conversation",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    expect(await audioEvents(provider, 1)).toEqual(["transcript.partial"]);
    vi.advanceTimersByTime(1200);
    expect(await audioEvents(provider, 2)).toEqual([]);
    vi.advanceTimersByTime(3800);
    expect(await audioEvents(provider, 3)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
  });
});

function timeoutProvider(listeningMaxContinuationBufferMs: number) {
  return new LmStudioRealtimeProvider({
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "tencent/Hy-MT2-1.8B",
    timeoutMs: 100,
    listeningMaxContinuationBufferMs,
    asrProvider: queuedAsrProviderWithEmptyFrames(),
    translationClient: {
      translate: async () => "We will discuss the product plan today.",
      healthCheck: async () => true,
    },
  });
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

function queuedAsrProviderWithEmptyFrames(): AsrProvider {
  let first = true;
  return {
    createSession: async () => undefined,
    transcribe: async () => {
      if (!first) return null;
      first = false;
      return {
        segmentId: "qwen3_seg_1",
        text: "今天下午讨论产品计划，",
        language: "zh" as const,
        endpointReason: "max_duration" as const,
      };
    },
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function queuedAsrProvider(): AsrProvider {
  const queue = [
    {
      segmentId: "qwen3_seg_800",
      text: "今天下午三点我们讨论产品计划，确认负责。",
      language: "zh" as const,
      endpointReason: "max_duration" as const,
    },
    {
      segmentId: "qwen3_seg_857",
      text: "负责人和截止日期，然后发送给所有参会人员。",
      language: "zh" as const,
      endpointReason: "silence" as const,
    },
  ];
  return {
    createSession: async () => undefined,
    transcribe: async () => queue.shift() ?? null,
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function safeListeningContinuationProvider(): AsrProvider {
  const speaker = {
    speakerId: "speaker_1",
    role: "speaker" as const,
    source: "diarization" as const,
  };
  const queue = [
    {
      segmentId: "qwen3_seg_418", turnId: "turn_1", revision: 6,
      text: "我会整。", language: "zh" as const,
      endpointReason: "max_duration" as const, speaker,
      timing: { startMs: 0, endMs: 6000, source: "client" as const },
    },
    {
      segmentId: "qwen3_seg_478", turnId: "turn_1", revision: 2,
      isFinal: false, text: "整理会议纪要", language: "zh" as const,
      speaker,
      timing: { startMs: 6001, endMs: 9000, source: "client" as const },
    },
    {
      segmentId: "qwen3_seg_478", turnId: "turn_1", revision: 3,
      text: "整理会议纪要，并在下班前发给大家确认。",
      language: "zh" as const, endpointReason: "silence" as const, speaker,
      timing: { startMs: 6001, endMs: 11600, source: "client" as const },
    },
  ];
  return {
    createSession: async () => undefined,
    transcribe: async () => queue.shift() ?? null,
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function audioFrame(sequence: number) {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence,
    timestampMs: sequence,
    format: "pcm16" as const,
    sampleRate: 24000,
    data: "AA==",
  };
}
