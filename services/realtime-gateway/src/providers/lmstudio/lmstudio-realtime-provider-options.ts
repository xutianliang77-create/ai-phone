import type { DeviceSpeakerEvidenceEvent, TermbaseTermDto } from "@translation/contracts";
import type { LlmProvider } from "@translation/llm";
import type { AsrProvider, TranscriptResult } from "../../asr/asr-provider.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";

export interface TranslationClient {
  supportsContext?:true;
  supportsAbort?:true;
  supportsAttemptContext?:true;
  translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    terminology?: TermbaseTermDto[];
    context?: Array<{sourceText:string;translatedText:string}>;
    signal?:AbortSignal;
    attemptContext?:{segmentId:string;revision:number};
  }): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export interface LmStudioRealtimeProviderOptions {
  deviceSpeakerReceiver?: (event: DeviceSpeakerEvidenceEvent, acceptedSamples: number) => boolean;
  deviceSpeakerRefresh?: (transcripts:TranscriptResult[])=>TranscriptResult[];
  /** Internal public assembly only: one exact session, no implicit reconnect/rebind. */
  publicSession?: RealtimeProviderSession;
  providerName?: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens?: number;
  reasoningEffort?: string | null;
  extraBody?: Record<string, unknown>;
  asrProvider?: AsrProvider;
  maxInputBatchAudioMs?: number;
  translationClient?: TranslationClient;
  asrRefinementProvider?: LlmProvider;
  asrRefinementEnabled?: boolean;
  asrRefinementMinConfidence?: number;
  listeningMaxContinuationBufferMs?: number;
}
