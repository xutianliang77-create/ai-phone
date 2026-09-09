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
import {abortable} from "../providers/abortable.js";
import {transcribeCompletedAudio,type CompletedAsrAudio,type CompletedAsrOptions} from "./public-asr-completed-audio.js";

export interface HttpAsrClientOptions {
  endpoint: string;
  flushEndpoint?: string;
  healthUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export interface HttpAsrRequest {
  acceptedAudioRange?:{startSample:number;endSample:number};
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

  transcribeCompletedAudio(input:CompletedAsrAudio,options:CompletedAsrOptions,signal?:AbortSignal){
    return transcribeCompletedAudio(input,options,this.options.endpoint,this.options.timeoutMs,this.fetchWithTimeout.bind(this),signal);
  }

  async transcribe(request: HttpAsrRequest,signal?:AbortSignal): Promise<TranscriptResult | null> {
    const {acceptedAudioRange:_internal,...payload}=request;
    return this.fetchWithTimeout(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    },async response=>{
    if (response.status === 204) return null;
    if (!response.ok)
      throw new Error(`HTTP ASR returned HTTP ${response.status}`);

    return this.parseTranscript(
      (await response.json()) as HttpAsrResponse,
      `asr_seg_${request.sequence}`,
    );
    },signal);
  }

  async flush(request: HttpAsrFlushRequest,signal?:AbortSignal): Promise<TranscriptResult | null> {
    return this.fetchWithTimeout(
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
      async response=>{
    if (response.status === 204) return null;
    if (!response.ok)
      throw new Error(`HTTP ASR flush returned HTTP ${response.status}`);

    return this.parseTranscript(
      (await response.json()) as HttpAsrResponse,
      "asr_flush",
    );
      },signal);
  }

  async commitBoundary(
    request: HttpAsrBoundaryRequest,
    signal?:AbortSignal,
  ): Promise<TranscriptResult | null> {
    return this.fetchWithTimeout(
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
      async response=>{
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(`HTTP ASR boundary returned HTTP ${response.status}`);
    }
    return this.parseTranscript(
      (await response.json()) as HttpAsrResponse,
      "asr_boundary",
    );
      },signal);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.fetchWithTimeout(this.sessionUrl(sessionId), {
      method: "DELETE",
      headers: this.headers(),
    },async response=>{
    if (!response.ok)
      throw new Error(`HTTP ASR close returned HTTP ${response.status}`);
    });
  }

  async diagnostics(sessionId: string,signal?:AbortSignal): Promise<RealtimeVadDiagnosticsDto> {
    return this.fetchWithTimeout(
      this.sessionUrl(sessionId) + "/diagnostics",
      { method: "GET", headers: this.headers() },
      async response=>{
    if (!response.ok) {
      throw new Error(`HTTP ASR diagnostics returned HTTP ${response.status}`);
    }
    return (await response.json()) as RealtimeVadDiagnosticsDto;
      },signal);
  }

  async healthCheck() {
    if (!this.options.healthUrl) return true;
    try {
      return await this.fetchWithTimeout(this.options.healthUrl, {
        method: "GET",
        headers: this.headers(),
      },async response=>response.ok);
    } catch {
      return false;
    }
  }

  private async fetchWithTimeout<T>(url: string, init: RequestInit,consume:(response:Response)=>Promise<T>,signal?:AbortSignal) {
    if(signal?.aborted)throw new DOMException("Aborted","AbortError");
    const controller = new AbortController();
    const cancel=()=>controller.abort();signal?.addEventListener("abort",cancel,{once:true});
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response:Response|undefined;
    try {
      response=await abortable(this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      }),controller.signal);
      return await abortable(consume(response),controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort",cancel);
      void response?.body?.cancel().catch(()=>{});
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
