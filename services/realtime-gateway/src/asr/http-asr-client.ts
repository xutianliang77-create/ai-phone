import type {
  AsrEndpointReason,
  AsrEndpointMode,
  AsrTokenTimingDto,
  AudioFormat,
  LanguageCode,
  TranslationLanguageCode,
  SegmentTimingDto,
  SpeakerAttributionDto,
  RealtimeVadDiagnosticsDto,
} from "@translation/contracts";
import {
  isAsrTokenTimings,
  isSegmentTiming,
  isSegmentVadContext,
  isSpeakerAttribution,
  isTranslationLanguage,
} from "@translation/contracts";
import { cleanRealtimeText } from "../protocol/realtime-text.js";
import type { TranscriptResult } from "./asr-provider.js";

export interface HttpAsrClientOptions {
  endpoint: string;
  flushEndpoint?: string;
  healthUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export interface HttpAsrRequest {
  sessionId: string;
  sequence: number;
  timestampMs: number;
  format: AudioFormat;
  sampleRate: number;
  data: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  mode?: AsrEndpointMode;
  hotwords?: string[];
  corrections?: Array<{ fromText: string; toText: string }>;
}

export interface HttpAsrFlushRequest {
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  mode?: AsrEndpointMode;
  hotwords?: string[];
  corrections?: Array<{ fromText: string; toText: string }>;
}

export interface HttpAsrBoundaryRequest extends HttpAsrFlushRequest {
  boundaryMs: number;
}

interface HttpAsrResponse {
  segmentId?: string;
  revision?: number;
  isFinal?: boolean;
  text?: string;
  language?: string;
  confidence?: number;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  tokenTimings?: AsrTokenTimingDto[];
  endpointReason?: string;
  vadContext?: unknown;
}

export class HttpAsrClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpAsrClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async transcribe(request: HttpAsrRequest): Promise<TranscriptResult | null> {
    const response = await this.fetchWithTimeout(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    if (response.status === 204) return null;
    if (!response.ok)
      throw new Error(`HTTP ASR returned HTTP ${response.status}`);

    return this.parseTranscript(
      (await response.json()) as HttpAsrResponse,
      `asr_seg_${request.sequence}`,
    );
  }

  async flush(request: HttpAsrFlushRequest): Promise<TranscriptResult | null> {
    const response = await this.fetchWithTimeout(
      this.flushUrl(request.sessionId),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          mode: request.mode ?? "conversation",
          hotwords: request.hotwords ?? [],
          corrections: request.corrections ?? [],
        }),
      },
    );
    if (response.status === 204) return null;
    if (!response.ok)
      throw new Error(`HTTP ASR flush returned HTTP ${response.status}`);

    return this.parseTranscript(
      (await response.json()) as HttpAsrResponse,
      "asr_flush",
    );
  }

  async commitBoundary(
    request: HttpAsrBoundaryRequest,
  ): Promise<TranscriptResult | null> {
    const response = await this.fetchWithTimeout(
      this.sessionUrl(request.sessionId) + "/boundary",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          boundaryMs: request.boundaryMs,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          mode: request.mode ?? "conversation",
          hotwords: request.hotwords ?? [],
          corrections: request.corrections ?? [],
        }),
      },
    );
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(`HTTP ASR boundary returned HTTP ${response.status}`);
    }
    return this.parseTranscript(
      (await response.json()) as HttpAsrResponse,
      "asr_boundary",
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    const response = await this.fetchWithTimeout(this.sessionUrl(sessionId), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!response.ok)
      throw new Error(`HTTP ASR close returned HTTP ${response.status}`);
  }

  async diagnostics(sessionId: string): Promise<RealtimeVadDiagnosticsDto> {
    const response = await this.fetchWithTimeout(
      this.sessionUrl(sessionId) + "/diagnostics",
      { method: "GET", headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(`HTTP ASR diagnostics returned HTTP ${response.status}`);
    }
    return (await response.json()) as RealtimeVadDiagnosticsDto;
  }

  async healthCheck() {
    if (!this.options.healthUrl) return true;
    try {
      const response = await this.fetchWithTimeout(this.options.healthUrl, {
        method: "GET",
        headers: this.headers(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
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

  private flushUrl(sessionId: string) {
    if (this.options.flushEndpoint) {
      return this.options.flushEndpoint.replace(
        ":sessionId",
        encodeURIComponent(sessionId),
      );
    }
    return this.sessionUrl(sessionId) + "/flush";
  }

  private sessionUrl(sessionId: string) {
    const base = this.options.endpoint.replace(/\/asr\/transcribe$/, "");
    return `${base}/asr/sessions/${encodeURIComponent(sessionId)}`;
  }

  private parseTranscript(body: HttpAsrResponse, fallbackSegmentId: string) {
    const text = cleanRealtimeText(body.text);
    if (!text) return null;
    if (!body.language || !isTranslationLanguage(body.language)) {
      throw new Error("HTTP ASR returned invalid language");
    }

    return {
      segmentId: body.segmentId ?? fallbackSegmentId,
      ...(Number.isInteger(body.revision) && Number(body.revision) >= 0
        ? { revision: Number(body.revision) }
        : {}),
      ...(body.isFinal === false ? { isFinal: false } : {}),
      text,
      language: body.language,
      confidence: body.confidence,
      ...(isSpeakerAttribution(body.speaker) ? { speaker: body.speaker } : {}),
      ...(isSegmentTiming(body.timing) ? { timing: body.timing } : {}),
      ...(isAsrTokenTimings(body.tokenTimings)
        ? { tokenTimings: body.tokenTimings }
        : {}),
      ...(isAsrEndpointReason(body.endpointReason)
        ? { endpointReason: body.endpointReason }
        : {}),
      ...(isSegmentVadContext(body.vadContext)
        ? { vadContext: body.vadContext }
        : {}),
    };
  }
}

function isAsrEndpointReason(value: unknown): value is AsrEndpointReason {
  return value === "silence" || value === "max_duration" || value === "flush" ||
    value === "speaker_boundary";
}

export function cleanRealtimeTranscript(text: string | undefined) {
  return cleanRealtimeText(text);
}
