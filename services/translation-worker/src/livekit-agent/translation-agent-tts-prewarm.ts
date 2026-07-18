import type { TranslationWorkerEnv } from "../config/env.js";
import { HttpTtsProvider } from "../providers/http-tts-provider.js";

type TtsPrewarmEnv = Pick<
  TranslationWorkerEnv,
  | "ttsHttpEndpoint"
  | "ttsHttpApiKey"
  | "ttsAgentPrewarmTimeoutMs"
  | "ttsProvider"
  | "ttsModel"
  | "ttsVoice"
>;

export type TranslationAgentTtsPrewarmResult =
  | { status: "skipped"; reason: "tts_unconfigured" }
  | {
    status: "ready";
    elapsedMs: number;
    firstAudioMs?: number;
    provider?: string;
    model?: string;
    audioBytes: number;
    sampleRate: 16000 | 24000;
  };

export async function prewarmTranslationAgentTts(
  env: TtsPrewarmEnv,
  options: { fetchFn?: typeof fetch } = {},
): Promise<TranslationAgentTtsPrewarmResult> {
  if (!env.ttsHttpEndpoint) {
    return { status: "skipped", reason: "tts_unconfigured" };
  }

  const startedAt = Date.now();
  const provider = new HttpTtsProvider({
    endpoint: env.ttsHttpEndpoint,
    apiKey: env.ttsHttpApiKey,
    timeoutMs: env.ttsAgentPrewarmTimeoutMs,
    provider: env.ttsProvider,
    model: env.ttsModel,
    voice: env.ttsVoice,
    fetchFn: options.fetchFn,
  });
  const speech = await provider.synthesize({
    text: "准备就绪",
    language: "zh",
    speakerRole: "host",
    segmentId: "agent-node-prewarm",
    speechId: "speech:agent-node-prewarm",
    turnId: "turn:agent-node-prewarm",
    revision: 1,
    pipelineGeneration: 1,
    signal: new AbortController().signal,
  });
  if (!speech?.audio) {
    throw new Error("Translation Agent TTS prewarm returned no playable audio");
  }

  return {
    status: "ready",
    elapsedMs: Date.now() - startedAt,
    firstAudioMs: speech.firstAudioMs,
    provider: speech.provider,
    model: speech.model,
    audioBytes: Buffer.from(speech.audio.data, "base64").byteLength,
    sampleRate: speech.audio.sampleRate,
  };
}
