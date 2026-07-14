import type { CallTtsAudioSink } from "../worker/types.js";

export interface HttpTtsAudioSinkOptions {
  endpoint: string;
  interruptEndpoint?: string;
  apiKey?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpTtsAudioSink implements CallTtsAudioSink {
  private readonly fetchFn: typeof fetch;
  readonly capabilities;

  constructor(private readonly options: HttpTtsAudioSinkOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.capabilities = {
      bidirectionalMedia: Boolean(options.interruptEndpoint),
      streamingWrite: false,
      clearPlayback: Boolean(options.interruptEndpoint),
    };
  }

  async play(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    const response = await this.fetchWithTimeout(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        callId: input.callId,
        sessionId: input.callId,
        segmentId: input.segmentId,
        playbackId: input.playbackId,
        generation: input.generation,
        sourceLegId: input.sourceLegId,
        targetLegId: input.targetLegId,
        sourceSpeakerRole: input.sourceSpeakerRole,
        targetSpeakerRole: input.targetSpeakerRole,
        language: input.language,
        provider: input.speech.provider,
        model: input.speech.model,
        firstAudioMs: input.speech.firstAudioMs,
        audioDurationMs: input.speech.audioDurationMs,
        audio: input.speech.audio,
      }),
    }, input.signal);
    if (!response.ok) throw new Error(`HTTP TTS audio sink returned HTTP ${response.status}`);
    const body = await readJson(response);
    return {
      status: body?.status === "queued" ? "queued" as const : "played" as const,
      ...(typeof body?.providerPlaybackId === "string"
        ? { providerPlaybackId: body.providerPlaybackId }
        : {}),
    };
  }

  async interrupt(input: Parameters<NonNullable<CallTtsAudioSink["interrupt"]>>[0]) {
    if (!this.options.interruptEndpoint) return { cleared: false };
    const response = await this.fetchWithTimeout(
      this.options.interruptEndpoint
        .replace(":callId", encodeURIComponent(input.callId))
        .replace(":playbackId", encodeURIComponent(input.playbackId)),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          sessionId: input.callId,
          targetLegId: input.targetLegId,
          generation: input.generation,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        }),
      },
    );
    if (!response.ok) return { cleared: false };
    const body = await readJson(response);
    return { cleared: body?.cleared === true };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }
}

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}
