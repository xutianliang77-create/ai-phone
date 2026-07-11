import type { TermbaseTermDto } from "@translation/contracts";
import type { LlmProvider } from "@translation/llm";
import type { AsrProvider } from "../../asr/asr-provider.js";

export interface TranslationClient {
  translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    terminology?: TermbaseTermDto[];
  }): Promise<string>;
  healthCheck(): Promise<boolean>;
}

export interface LmStudioRealtimeProviderOptions {
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
}
