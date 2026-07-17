import type {
  AsrEndpointReason,
  AudioFormat,
  AsrEndpointMode,
  CallRoomTranslationLanguage,
  LanguageCode,
  SegmentTimingDto,
} from "@translation/contracts";
import { isSegmentTiming, isSegmentVadContext } from "@translation/contracts";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallVadDecisionSink,
  TranscriptSegment,
} from "../worker/types.js";

export interface HttpAsrProviderOptions {
  endpoint: string;
  flushEndpoint?: string;
  apiKey?: string;
  timeoutMs: number;
  endpointMode?: AsrEndpointMode;
  hotwords?: string[];
  corrections?: Array<{ fromText: string; toText: string }>;
  fetchFn?: typeof fetch;
}

interface AsrResponse {
  segmentId?: string;
  speechId?: string;
  turnId?: string;
  revision?: number;
  text?: string;
  language?: CallRoomTranslationLanguage;
  confidence?: number | null;
  timing?: SegmentTimingDto;
  endpointReason?: string;
  vadContext?: unknown;
}

export class HttpAsrProvider implements CallAsrProvider {
  private readonly fetchFn: typeof fetch;
  private vadDecisionSink: CallVadDecisionSink | null = null;

  constructor(private readonly options: HttpAsrProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createCall(_callId: string) {}

  setVadDecisionSink(sink: CallVadDecisionSink | null) {
    this.vadDecisionSink = sink;
  }

  async transcribe(frame: CallAudioFrame): Promise<TranscriptSegment | null> {
    const response = await this.fetchWithTimeout(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        sessionId: asrSessionId(frame.sessionId, frame.speakerRole),
        sequence: frame.sequence,
        timestampMs: frame.timestampMs,
        format: frame.format satisfies AudioFormat,
        sampleRate: frame.sampleRate,
        data: frame.data,
        sourceLanguage: "auto" satisfies LanguageCode,
        targetLanguage: "zh" satisfies CallRoomTranslationLanguage,
        mode: this.options.endpointMode ?? "call_link",
        hotwords: this.options.hotwords ?? [],
        corrections: this.options.corrections ?? [],
      }),
    });
    this.emitVadDecision(response, frame);
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`HTTP ASR returned HTTP ${response.status}`);
    return parseAsrResponse(await response.json() as AsrResponse, `asr_${frame.sequence}`);
  }

  async flush(callId: string, speakerRole: CallAudioSpeakerRole) {
    const response = await this.fetchWithTimeout(
      this.flushUrl(asrSessionId(callId, speakerRole)),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          sourceLanguage: "auto" satisfies LanguageCode,
          targetLanguage: "zh" satisfies CallRoomTranslationLanguage,
          mode: this.options.endpointMode ?? "call_link",
          hotwords: this.options.hotwords ?? [],
          corrections: this.options.corrections ?? [],
        }),
      },
    );
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`HTTP ASR flush returned HTTP ${response.status}`);
    return parseAsrResponse(await response.json() as AsrResponse, "asr_flush");
  }

  async closeCall(_callId: string) {}

  private emitVadDecision(response: Response, frame: CallAudioFrame) {
    const headers = response.headers as Headers | undefined;
    const voiced = parseBooleanHeader(headers?.get("x-asr-vad-voiced"));
    const provider = headers?.get("x-asr-vad-provider")?.trim();
    const sequence = parseIntegerHeader(headers?.get("x-asr-vad-sequence"));
    if (voiced === undefined || !provider || sequence !== frame.sequence) return;
    const probability = parseRatioHeader(headers?.get("x-asr-vad-probability"));
    const timestampMs = parseIntegerHeader(
      headers?.get("x-asr-vad-timestamp-ms"),
    ) ?? frame.timestampMs;
    const durationMs = parseIntegerHeader(
      headers?.get("x-asr-vad-duration-ms"),
    ) ?? frameDurationMs(frame);
    const preRollMs = parseIntegerHeader(
      headers?.get("x-asr-vad-preroll-ms"),
    ) ?? 0;
    this.vadDecisionSink?.({
      callId: frame.sessionId,
      speakerRole: frame.speakerRole,
      sequence,
      timestampMs,
      durationMs,
      voiced,
      ...(probability === undefined ? {} : { probability }),
      provider,
      fallback: parseBooleanHeader(headers?.get("x-asr-vad-fallback")) === true,
      preRollMs,
    });
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

  private flushUrl(sessionId: string) {
    if (this.options.flushEndpoint) {
      return this.options.flushEndpoint.replace(":sessionId", encodeURIComponent(sessionId));
    }
    const base = this.options.endpoint.replace(/\/asr\/transcribe$/, "");
    return `${base}/asr/sessions/${encodeURIComponent(sessionId)}/flush`;
  }
}

function asrSessionId(callId: string, speakerRole: CallAudioSpeakerRole) {
  return `${callId}:${speakerRole}`;
}

function parseAsrResponse(
  body: AsrResponse,
  fallbackSegmentId: string,
): TranscriptSegment | null {
  const text = body.text?.trim();
  if (!text) return null;
  if (body.language !== "zh" && body.language !== "en") {
    throw new Error("HTTP ASR returned invalid language");
  }
  const confidence = normalizeConfidence(body.confidence);
  return {
    segmentId: body.segmentId ?? fallbackSegmentId,
    ...(validIdentifier(body.speechId) ? { speechId: body.speechId.trim() } : {}),
    ...(validIdentifier(body.turnId) ? { turnId: body.turnId.trim() } : {}),
    ...(validRevision(body.revision) ? { revision: body.revision } : {}),
    text,
    language: body.language,
    ...(confidence === undefined ? {} : { confidence }),
    ...(isSegmentTiming(body.timing) ? { timing: body.timing } : {}),
    ...(isAsrEndpointReason(body.endpointReason)
      ? { endpointReason: body.endpointReason }
      : {}),
    ...(isSegmentVadContext(body.vadContext)
      ? { vadContext: body.vadContext }
      : {}),
  };
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizeConfidence(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function isAsrEndpointReason(value: unknown): value is AsrEndpointReason {
  return value === "silence" || value === "max_duration" || value === "flush" ||
    value === "speaker_boundary";
}

function parseBooleanHeader(value: string | null | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseIntegerHeader(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseRatioHeader(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : undefined;
}

function frameDurationMs(frame: CallAudioFrame) {
  const byteLength = Buffer.from(frame.data, "base64").byteLength;
  return Math.max(0, Math.round(byteLength * 1000 / (frame.sampleRate * 2)));
}
