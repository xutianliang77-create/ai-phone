import type {
  CallTtsProvider,
  SynthesizedSpeech,
  TtsVoiceConfig,
} from "../worker/types.js";

export interface HttpTtsProviderOptions {
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
  provider?: string;
  model?: string;
  voice?: TtsVoiceConfig;
  streamEndpoint?: string;
  warmupEndpoint?: string;
  warmupMaxMs?: number;
  fetchFn?: typeof fetch;
}

interface TtsResponse {
  provider?: string;
  model?: string;
  voiceMode?: SynthesizedSpeech["voiceMode"];
  voiceProfileId?: string;
  firstAudioMs?: number;
  audioDurationMs?: number;
  audio?: {
    format?: string;
    sampleRate?: number;
    data?: string;
  };
}

export class HttpTtsProvider implements CallTtsProvider {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpTtsProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async synthesize(input: Parameters<CallTtsProvider["synthesize"]>[0]) {
    const startedAt = Date.now();
    const { signal, ...request } = input;
    const response = await this.fetchWithTimeout(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...request,
        voice: input.voice ?? this.options.voice,
      }),
    }, signal);
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`HTTP TTS returned HTTP ${response.status}`);
    return normalizeSpeech(
      await response.json() as TtsResponse,
      Date.now() - startedAt,
      {
        provider: this.options.provider,
        model: this.options.model,
      },
    );
  }

  async *synthesizeStream(input: Parameters<CallTtsProvider["synthesize"]>[0]) {
    if (!this.options.streamEndpoint) {
      const speech = await this.synthesize(input);
      if (!speech) return;
      yield { type: "metadata" as const, speech: { ...speech, audio: undefined } };
      if (speech.audio) {
        yield { type: "audio_chunk" as const, sequence: 1, audio: speech.audio };
      }
      yield { type: "final" as const };
      return;
    }
    const { signal, ...request } = input;
    const response = await this.fetchWithTimeout(this.options.streamEndpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...request,
        voice: input.voice ?? this.options.voice,
      }),
    }, signal);
    if (!response.ok || !response.body) {
      throw new Error(`HTTP TTS stream returned HTTP ${response.status}`);
    }
    for await (const message of parseNdjson(response.body, signal)) {
      if (message.type === "metadata") {
        yield {
          type: "metadata" as const,
          speech: normalizeSpeechMetadata(message, {
            provider: this.options.provider,
            model: this.options.model,
          }),
        };
      } else if (message.type === "audio_chunk") {
        const audio = normalizeAudio(message);
        if (!audio) throw new Error("HTTP TTS stream returned invalid PCM chunk");
        yield {
          type: "audio_chunk" as const,
          sequence: positiveInteger(message.sequence),
          audio,
        };
      } else if (message.type === "final") {
        yield { type: "final" as const };
      }
    }
  }

  async warmup(input: Parameters<NonNullable<CallTtsProvider["warmup"]>>[0]) {
    if (!this.options.warmupEndpoint) {
      return { cached: true, elapsedMs: 0 };
    }
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(this.options.warmupEndpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        text: "准备就绪",
        language: "zh",
        speakerRole: "host",
        segmentId: "tts-warmup",
        voice: input.voice ?? this.options.voice,
      }),
    }, input.signal);
    if (!response.ok) throw new Error(`HTTP TTS warmup returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const elapsedMs = finiteOrUndefined(body.elapsedMs) ?? Date.now() - startedAt;
    if (this.options.warmupMaxMs && elapsedMs > this.options.warmupMaxMs) {
      throw new Error(`HTTP TTS warmup exceeded ${this.options.warmupMaxMs}ms`);
    }
    return {
      cached: body.cached === true,
      elapsedMs,
      firstAudioMs: finiteOrUndefined(body.firstAudioMs),
      provider: stringOrUndefined(body.provider),
      model: stringOrUndefined(body.model),
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal: AbortSignal,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal.reason);
    if (externalSignal.aborted) abort();
    externalSignal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      externalSignal.removeEventListener("abort", abort);
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }
}

function normalizeSpeech(
  body: TtsResponse,
  fallbackFirstAudioMs: number,
  configuredIdentity: { provider?: string; model?: string },
): SynthesizedSpeech {
  assertCompatibleIdentity("provider", body.provider, configuredIdentity.provider);
  assertCompatibleIdentity("model", body.model, configuredIdentity.model);
  const audio = normalizeAudio(body.audio);
  if (!audio) throw new Error("HTTP TTS returned no playable PCM audio");
  return {
    provider: body.provider ?? configuredIdentity.provider,
    model: body.model ?? configuredIdentity.model,
    voiceMode: normalizeVoiceMode(body.voiceMode),
    voiceProfileId: stringOrUndefined(body.voiceProfileId),
    firstAudioMs: finiteOrUndefined(body.firstAudioMs) ?? fallbackFirstAudioMs,
    audioDurationMs: finiteOrUndefined(body.audioDurationMs),
    audio,
  };
}

function normalizeSpeechMetadata(
  body: TtsResponse,
  configuredIdentity: { provider?: string; model?: string },
): SynthesizedSpeech {
  assertCompatibleIdentity("provider", body.provider, configuredIdentity.provider);
  assertCompatibleIdentity("model", body.model, configuredIdentity.model);
  return {
    provider: body.provider ?? configuredIdentity.provider,
    model: body.model ?? configuredIdentity.model,
    voiceMode: normalizeVoiceMode(body.voiceMode),
    voiceProfileId: stringOrUndefined(body.voiceProfileId),
    firstAudioMs: finiteOrUndefined(body.firstAudioMs),
    audioDurationMs: finiteOrUndefined(body.audioDurationMs),
  };
}

function assertCompatibleIdentity(
  field: "provider" | "model",
  actual: string | undefined,
  expected: string | undefined,
) {
  if (!actual || !expected) return;
  const actualValue = field === "provider" ? actual.toLowerCase() : actual;
  const expectedValue = field === "provider" ? expected.toLowerCase() : expected;
  if (actualValue !== expectedValue) {
    throw new Error(`HTTP TTS returned unexpected ${field}: ${actual}`);
  }
}

function normalizeAudio(audio: TtsResponse["audio"]) {
  if (!audio?.data || audio.format !== "pcm16") return undefined;
  const sampleRate = parseSampleRate(audio.sampleRate);
  if (!sampleRate) return undefined;
  return {
    format: "pcm16" as const,
    sampleRate,
    data: audio.data,
  };
}

function parseSampleRate(value: unknown): 16000 | 24000 | null {
  if (value === 16000) return 16000;
  if (value === 24000) return 24000;
  return null;
}

function finiteOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeVoiceMode(value: unknown): SynthesizedSpeech["voiceMode"] {
  return value === "preset" ||
    value === "voice_design" ||
    value === "personal_clone" ||
    value === "ultimate_clone"
    ? value
    : undefined;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("HTTP TTS stream returned invalid chunk sequence");
  }
  return parsed;
}

async function* parseNdjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error("TTS stream aborted");
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
      }
      if (done) {
        if (buffered.trim()) yield JSON.parse(buffered) as Record<string, unknown>;
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
