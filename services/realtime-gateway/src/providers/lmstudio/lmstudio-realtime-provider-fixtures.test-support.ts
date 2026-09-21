import type { AsrProvider } from "../../asr/asr-provider.js";

export function fixedAsrProvider(text = "hello, this is a realtime translation test"): AsrProvider {
  return {
    createSession: async () => undefined,
    transcribe: async () => ({
      segmentId: "asr_seg_8",
      text,
      language: "en",
      confidence: 0.9,
    }),
    flush: async () => ({
      segmentId: "asr_flush_9",
      text: "tail audio",
      language: "en",
      confidence: 0.8,
    }),
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}


export function queuedAsrProvider(results: Array<{
  segmentId: string;
  text: string;
  language: "en" | "zh";
  confidence?: number;
}>): AsrProvider {
  const queue = [...results];
  return {
    createSession: async () => undefined,
    transcribe: async () => queue.shift() ?? null,
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}


export function audioFrame(sequence: number) {
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
