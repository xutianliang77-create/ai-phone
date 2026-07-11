import type { CallTtsAudioSink } from "../worker/types.js";

export interface HttpTtsAudioSinkOptions {
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpTtsAudioSink implements CallTtsAudioSink {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpTtsAudioSinkOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async play(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    const response = await this.fetchWithTimeout(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        callId: input.callId,
        segmentId: input.segmentId,
        sourceSpeakerRole: input.sourceSpeakerRole,
        targetSpeakerRole: input.targetSpeakerRole,
        language: input.language,
        provider: input.speech.provider,
        model: input.speech.model,
        firstAudioMs: input.speech.firstAudioMs,
        audioDurationMs: input.speech.audioDurationMs,
        audio: input.speech.audio,
      }),
    });
    if (!response.ok) throw new Error(`HTTP TTS audio sink returned HTTP ${response.status}`);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }
}
