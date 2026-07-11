import type {
  AudioOutput,
  RealtimeVoiceConfig,
  TranslationEvent,
} from "@translation/contracts";
import type { RealtimeEnv } from "../config/env.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";

interface TtsResponse {
  audio?: {
    format?: string;
    sampleRate?: number;
    data?: string;
  };
}

export class HttpTtsSynthesizer {
  private readonly sequenceBySession = new Map<string, number>();

  constructor(private readonly env: RealtimeEnv) {}

  get enabled() {
    return Boolean(this.env.ttsHttpEndpoint);
  }

  async synthesize(
    event: TranslationEvent,
    voice?: RealtimeVoiceConfig,
  ): Promise<AudioOutput | null> {
    const endpoint = this.env.ttsHttpEndpoint;
    if (!endpoint || event.type !== "translation.final") return null;
    const text = event.text.trim();
    if (!text) return null;

    const response = await this.fetchWithTimeout(endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        text,
        language: normalizeTtsLanguage(event.language),
        speakerRole: "guest",
        segmentId: event.segmentId,
        ...(voice ? { voice } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP TTS returned HTTP ${response.status}`);
    }

    const body = await response.json() as TtsResponse;
    const audio = body.audio;
    if (!audio?.data || audio.format !== "pcm16") {
      throw new Error("HTTP TTS returned no playable PCM audio");
    }
    const sampleRate = parseSampleRate(audio.sampleRate);
    if (!sampleRate) {
      throw new Error(`HTTP TTS returned unsupported sample rate: ${audio.sampleRate}`);
    }

    return {
      type: "audio.output",
      sessionId: event.sessionId,
      segmentId: event.segmentId,
      format: "pcm16",
      sampleRate,
      sequence: this.nextSequence(event.sessionId),
      data: audio.data,
    };
  }

  closeSession(sessionId: string) {
    this.sequenceBySession.delete(sessionId);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.ttsHttpTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.env.ttsHttpApiKey
        ? { authorization: `Bearer ${this.env.ttsHttpApiKey}` }
        : {}),
    };
  }

  private nextSequence(sessionId: string) {
    const next = (this.sequenceBySession.get(sessionId) ?? 0) + 1;
    this.sequenceBySession.set(sessionId, next);
    return next;
  }
}

export function logRealtimeTtsFailure(
  sessionId: string,
  segmentId: string,
  error: unknown,
) {
  realtimeLogger.warn({
    ...toLoggableError(error),
    sessionId,
    segmentId,
  }, "Realtime TTS synthesis failed");
}

function toLoggableError(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return { errorMessage: String(error) };
}

function normalizeTtsLanguage(language: string) {
  return language === "zh" ? "zh" : "en";
}

function parseSampleRate(value: unknown): 16000 | 24000 | null {
  if (value === 16000) return 16000;
  if (value === 24000) return 24000;
  return null;
}
