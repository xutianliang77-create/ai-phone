import type { TermbaseTermDto } from "@translation/contracts";
import type { LlmProvider } from "@translation/llm";
import type { AsrProvider } from "../../asr/asr-provider.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";

export interface TranslationClient {
  supportsAbort?:true;
  supportsAttemptContext?:true;
  translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    terminology?: TermbaseTermDto[];
    signal?:AbortSignal;
    attemptContext?:{segmentId:string;revision:number};
  }): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export interface LmStudioRealtimeProviderOptions {
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
  translationClient?: TranslationClient;
  asrRefinementProvider?: LlmProvider;
  asrRefinementEnabled?: boolean;
  asrRefinementMinConfidence?: number;
  listeningMaxContinuationBufferMs?: number;
}
