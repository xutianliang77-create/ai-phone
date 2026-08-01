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

interface TtsStreamEvent {
  type?: string;
  format?: string;
  sampleRate?: number;
  data?: string;
}

export class HttpTtsSynthesizer {
  private readonly sequenceBySession = new Map<string, number>();
  private readonly requestsBySession = new Map<string, Set<AbortController>>();

  constructor(private readonly env: RealtimeEnv) {}

  get enabled() {
    return Boolean(this.env.ttsHttpEndpoint || this.env.ttsHttpStreamEndpoint);
  }

  async synthesize(
    event: TranslationEvent,
    voice?: RealtimeVoiceConfig,
  ): Promise<AudioOutput | null> {
    const endpoint = this.env.ttsHttpEndpoint;
    if (!endpoint || event.type !== "translation.final") return null;
    const text = event.text.trim();
    if (!text) return null;

    const request = this.beginRequest(event.sessionId);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(ttsPayload(event, voice)),
        signal: request.controller.signal,
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

      return this.audioOutput(event, sampleRate, audio.data);
    } finally {
      request.done();
    }
  }

  async *synthesizeStream(
    event: TranslationEvent,
    voice?: RealtimeVoiceConfig,
  ): AsyncIterable<AudioOutput> {
    const endpoint = this.env.ttsHttpStreamEndpoint;
    if (!endpoint) {
      const audio = await this.synthesize(event, voice);
      if (audio) yield audio;
      return;
    }
    if (event.type !== "translation.final" || !event.text.trim()) return;

    const request = this.beginRequest(event.sessionId);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(ttsPayload(event, voice)),
        signal: request.controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP TTS stream returned HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("HTTP TTS stream returned no body");
      }

      let sampleRate: 16000 | 24000 | null = null;
      let buffered: Buffer[] = [];
      let bufferedBytes = 0;
      let prefillSent = false;
      let finalSeen = false;
      for await (const chunk of parseTtsStream(response.body)) {
        if (chunk.type === "final") {
          finalSeen = true;
          continue;
        }
        if (chunk.type !== "audio_chunk" || !chunk.data) continue;
        const chunkRate = parseSampleRate(chunk.sampleRate);
        if (!chunkRate || chunk.format !== "pcm16") {
          throw new Error("HTTP TTS stream returned unsupported PCM audio");
        }
        if (sampleRate !== null && sampleRate !== chunkRate) {
          throw new Error("HTTP TTS stream changed sample rate");
        }
        sampleRate = chunkRate;
        const pcm = Buffer.from(chunk.data, "base64");
        if (pcm.length === 0 || pcm.length % 2 !== 0) {
          throw new Error("HTTP TTS stream returned invalid PCM audio");
        }
        buffered.push(pcm);
        bufferedBytes += pcm.length;
        const prefillBytes = Math.ceil(
          chunkRate * 2 * this.env.ttsStreamPrefillMs / 1000,
        );
        if (!prefillSent && bufferedBytes >= prefillBytes) {
          yield this.audioOutput(
            event,
            chunkRate,
            Buffer.concat(buffered).toString("base64"),
          );
          prefillSent = true;
          buffered = [];
          bufferedBytes = 0;
        }
      }
      if (!finalSeen) {
        throw new Error("HTTP TTS stream ended without a final event");
      }
      if (sampleRate === null) {
        throw new Error("HTTP TTS stream returned no playable PCM audio");
      }
      if (bufferedBytes > 0) {
        yield this.audioOutput(
          event,
          sampleRate,
          Buffer.concat(buffered).toString("base64"),
        );
      }
    } finally {
      request.done();
    }
  }

  closeSession(sessionId: string) {
    this.cancelSession(sessionId);
    this.sequenceBySession.delete(sessionId);
  }

  cancelSession(sessionId: string) {
    for (const controller of this.requestsBySession.get(sessionId) ?? []) {
      controller.abort();
    }
    this.requestsBySession.delete(sessionId);
  }

  private beginRequest(sessionId: string) {
    const controller = new AbortController();
    const requests = this.requestsBySession.get(sessionId) ?? new Set<AbortController>();
    requests.add(controller);
    this.requestsBySession.set(sessionId, requests);
    const timer = setTimeout(() => controller.abort(), this.env.ttsHttpTimeoutMs);
    return {
      controller,
      done: () => {
      clearTimeout(timer);
      requests.delete(controller);
      if (requests.size === 0 && this.requestsBySession.get(sessionId) === requests) {
        this.requestsBySession.delete(sessionId);
      }
      },
    };
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

  private audioOutput(
    event: TranslationEvent,
    sampleRate: 16000 | 24000,
    data: string,
  ): AudioOutput {
    return {
      type: "audio.output",
      sessionId: event.sessionId,
      segmentId: event.segmentId,
      format: "pcm16",
      sampleRate,
      sequence: this.nextSequence(event.sessionId),
      data,
    };
  }
}

function ttsPayload(event: TranslationEvent, voice?: RealtimeVoiceConfig) {
  return {
    text: event.text.trim(),
    language: normalizeTtsLanguage(event.language),
    speakerRole: "guest",
    segmentId: event.segmentId,
    ...(voice ? { voice } : {}),
  };
}

async function* parseTtsStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<TtsStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as TtsStreamEvent;
      }
      if (done) break;
    }
    if (pending.trim()) yield JSON.parse(pending) as TtsStreamEvent;
  } finally {
    reader.releaseLock();
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
