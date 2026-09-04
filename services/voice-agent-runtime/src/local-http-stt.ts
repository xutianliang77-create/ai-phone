import {
  APIConnectionError,
  type APIConnectOptions,
  APIError,
  APIStatusError,
  APITimeoutError,
  asLanguageCode,
  mergeFrames,
  stt,
} from "@livekit/agents";
import type { AudioBuffer } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { randomUUID } from "node:crypto";

const SAMPLE_RATE = 16_000;
const DEVICE_CHUNK_BYTES = 6400;

export interface LocalHttpSTTOptions {
  baseUrl: string;
  apiKey?: string;
  language: "zh" | "en";
  model: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

interface Transcript {
  requestId: string;
  text: string;
  language: string;
  confidence: number;
  isFinal: boolean;
}

interface TranscribeResult {
  transcript?: Transcript;
  voiced?: boolean;
}

export class LocalHttpSTT extends stt.STT {
  readonly label = "local-http.STT";
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(readonly options: LocalHttpSTTOptions) {
    super({ streaming: true, interimResults: true, alignedTranscript: false });
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  override get model() {
    return this.options.model;
  }

  override get provider() {
    return "local_http";
  }

  stream(options?: { connOptions?: APIConnectOptions }) {
    return new LocalHttpSpeechStream(this, options?.connOptions);
  }

  protected async _recognize(frame: AudioBuffer, abortSignal?: AbortSignal) {
    const merged = mergeFrames(frame);
    const sessionId = `voice-agent-${randomUUID()}`;
    try {
      const result = await this.transcribe(
        sessionId,
        1,
        0,
        pcm16le(merged),
        abortSignal,
      );
      const transcript = result.transcript ??
        (await this.flush(sessionId, abortSignal)).transcript;
      return transcriptEvent(transcript, 0);
    } finally {
      await this.closeSession(sessionId);
    }
  }

  async transcribe(
    sessionId: string,
    sequence: number,
    timestampMs: number,
    pcm: Buffer,
    signal?: AbortSignal,
  ): Promise<TranscribeResult> {
    const response = await this.request("/asr/transcribe", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        sessionId,
        sequence,
        timestampMs,
        format: "pcm16",
        sampleRate: SAMPLE_RATE,
        data: pcm.toString("base64"),
        sourceLanguage: this.options.language,
        targetLanguage: this.options.language,
        mode: "pstn",
        hotwords: [],
        corrections: [],
      }),
    }, signal);
    return {
      ...await parseTranscript(response, `asr-segment-${sequence}`),
      ...parseVoiced(response.headers),
    };
  }

  async flush(sessionId: string, signal?: AbortSignal): Promise<TranscribeResult> {
    const response = await this.request(
      `/asr/sessions/${encodeURIComponent(sessionId)}/flush`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          sourceLanguage: this.options.language,
          targetLanguage: this.options.language,
          mode: "pstn",
          hotwords: [],
          corrections: [],
        }),
      },
      signal,
    );
    return parseTranscript(response, "asr-flush");
  }

  async closeSession(sessionId: string) {
    try {
      await this.request(`/asr/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: this.headers(),
      });
    } catch {
      // Best-effort cleanup; the stream's primary error remains authoritative.
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey
        ? { authorization: `Bearer ${this.options.apiKey}` }
        : {}),
    };
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal) {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        signal: requestSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw new APITimeoutError({ message: "Local ASR request timed out" });
      }
      throw new APIConnectionError({
        message: `Local ASR request failed: ${errorMessage(error)}`,
      });
    }
    if (!response.ok && response.status !== 204) {
      throw new APIStatusError({
        message: `Local ASR returned HTTP ${response.status}`,
        options: {
          statusCode: response.status,
          requestId: response.headers.get("x-request-id"),
          retryable: response.status >= 500,
        },
      });
    }
    return response;
  }
}

class LocalHttpSpeechStream extends stt.SpeechStream {
  readonly label = "local-http.SpeechStream";
  private buffered = Buffer.alloc(0);
  private sequence = 0;
  private audioMs = 0;
  private inSpeech = false;
  private needsFlush = false;
  private readonly sessionId = `voice-agent-${randomUUID()}`;

  constructor(
    private readonly client: LocalHttpSTT,
    connOptions?: APIConnectOptions,
  ) {
    super(client, SAMPLE_RATE, connOptions);
  }

  protected async run() {
    try {
      for await (const input of this.input) {
        if (input === LocalHttpSpeechStream.FLUSH_SENTINEL) {
          await this.flushPending();
          continue;
        }
        this.buffered = Buffer.concat([this.buffered, pcm16le(input)]);
        while (this.buffered.length >= DEVICE_CHUNK_BYTES) {
          const chunk = this.buffered.subarray(0, DEVICE_CHUNK_BYTES);
          this.buffered = this.buffered.subarray(DEVICE_CHUNK_BYTES);
          await this.sendChunk(chunk);
        }
      }
      await this.flushPending();
      this.queue.put({
        type: stt.SpeechEventType.RECOGNITION_USAGE,
        requestId: this.sessionId,
        recognitionUsage: { audioDuration: this.audioMs / 1000 },
      });
    } finally {
      await this.client.closeSession(this.sessionId);
    }
  }

  private async sendChunk(pcm: Buffer) {
    this.sequence += 1;
    const timestampMs = this.audioMs;
    this.audioMs += pcm.length / 2 / SAMPLE_RATE * 1000;
    this.needsFlush = true;
    const result = await this.client.transcribe(
      this.sessionId,
      this.sequence,
      timestampMs,
      pcm,
      this.abortSignal,
    );
    this.emitResult(result);
    if (result.transcript?.isFinal) this.needsFlush = false;
  }

  private async flushPending() {
    if (this.buffered.length > 0) {
      const pending = this.buffered;
      this.buffered = Buffer.alloc(0);
      await this.sendChunk(pending);
    }
    if (!this.needsFlush) return;
    const result = await this.client.flush(this.sessionId, this.abortSignal);
    this.emitResult(result);
    if (this.inSpeech) {
      this.inSpeech = false;
      this.queue.put({ type: stt.SpeechEventType.END_OF_SPEECH });
    }
    this.needsFlush = false;
  }

  private emitResult(result: TranscribeResult) {
    if ((result.voiced || result.transcript) && !this.inSpeech) {
      this.inSpeech = true;
      this.queue.put({ type: stt.SpeechEventType.START_OF_SPEECH });
    }
    if (!result.transcript) return;
    this.queue.put(transcriptEvent(result.transcript, this.audioMs / 1000));
    if (result.transcript.isFinal && this.inSpeech) {
      this.inSpeech = false;
      this.queue.put({ type: stt.SpeechEventType.END_OF_SPEECH });
    }
  }
}

function pcm16le(frame: AudioFrame) {
  if (frame.sampleRate !== SAMPLE_RATE || frame.channels !== 1 ||
    frame.data.length !== frame.samplesPerChannel) {
    throw new APIError("Local ASR requires 16 kHz mono PCM16", {
      retryable: false,
    });
  }
  const pcm = Buffer.allocUnsafe(frame.samplesPerChannel * 2);
  for (let index = 0; index < frame.data.length; index += 1) {
    pcm.writeInt16LE(frame.data[index]!, index * 2);
  }
  return pcm;
}

async function parseTranscript(
  response: Response,
  fallbackRequestId: string,
): Promise<TranscribeResult> {
  if (response.status === 204) return {};
  const body = await response.json() as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const language = typeof body.language === "string" ? body.language.trim() : "";
  if (!text || !language) {
    throw new APIError("Local ASR returned an invalid transcript", {
      retryable: false,
    });
  }
  const confidence = typeof body.confidence === "number" &&
    body.confidence >= 0 && body.confidence <= 1 ? body.confidence : 1;
  return {
    transcript: {
      requestId: typeof body.segmentId === "string" && body.segmentId
        ? body.segmentId
        : fallbackRequestId,
      text,
      language,
      confidence,
      isFinal: body.isFinal !== false,
    },
  };
}

function parseVoiced(headers: Headers): Pick<TranscribeResult, "voiced"> {
  const value = headers.get("x-asr-vad-voiced");
  return value === "true" ? { voiced: true }
    : value === "false" ? { voiced: false }
      : {};
}

function transcriptEvent(transcript: Transcript | undefined, endTime: number) {
  return {
    type: transcript?.isFinal === false
      ? stt.SpeechEventType.INTERIM_TRANSCRIPT
      : stt.SpeechEventType.FINAL_TRANSCRIPT,
    requestId: transcript?.requestId,
    alternatives: [{
      text: transcript?.text ?? "",
      language: asLanguageCode(transcript?.language ?? ""),
      startTime: 0,
      endTime,
      confidence: transcript?.confidence ?? 0,
    }] as [stt.SpeechData],
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
