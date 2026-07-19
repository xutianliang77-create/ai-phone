import type { AsrEndpointMode } from "@translation/contracts";
import type { TranslationWorkerEnv } from "../config/env.js";
import type {
  CallAsrProvider,
  CallTranslationProvider,
  CallTtsProvider,
} from "../worker/types.js";
import {
  StickyProviderFallbackController,
  type ProviderFallbackTransition,
} from "../worker/provider-fallback-controller.js";
import { FallbackAsrProvider } from "./fallback-asr-provider.js";
import { FallbackTranslationProvider } from "./fallback-translation-provider.js";
import { FallbackTtsProvider } from "./fallback-tts-provider.js";
import { HttpAsrProvider } from "./http-asr-provider.js";
import { HttpTtsProvider } from "./http-tts-provider.js";
import { OpenAiCompatibleTranslationProvider } from
  "./openai-compatible-translation-provider.js";

export function createDefaultCallProviders(input: {
  env: TranslationWorkerEnv;
  endpointMode: AsrEndpointMode;
  hotwords: string[];
  corrections: Array<{ fromText: string; toText: string }>;
  onTransition: (transition: ProviderFallbackTransition) => Promise<void> | void;
}) {
  return {
    asrProvider: createAsrProvider(input),
    translationProvider: createTranslationProvider(input),
    ttsProvider: createTtsProvider(input),
  };
}

function createAsrProvider(
  input: Parameters<typeof createDefaultCallProviders>[0],
): CallAsrProvider {
  const primary = new HttpAsrProvider({
    endpoint: input.env.asrHttpEndpoint,
    flushEndpoint: input.env.asrHttpFlushEndpoint,
    streamEndpoint: input.env.asrStreamEndpoint,
    streamFallbackToHttp: input.env.asrStreamFallbackToHttp,
    apiKey: input.env.asrHttpApiKey,
    timeoutMs: input.env.asrHttpTimeoutMs,
    endpointMode: input.endpointMode,
    hotwords: input.hotwords,
    corrections: input.corrections,
  });
  const route = input.env.asrFallback;
  if (!route) return primary;
  const fallback = new HttpAsrProvider({
    endpoint: route.endpoint,
    flushEndpoint: route.flushEndpoint,
    streamEndpoint: route.streamEndpoint,
    streamFallbackToHttp: true,
    apiKey: route.apiKey,
    timeoutMs: route.timeoutMs,
    endpointMode: input.endpointMode,
    hotwords: input.hotwords,
    corrections: input.corrections,
  });
  return new FallbackAsrProvider({
    primary,
    fallback,
    controller: controller(input, "asr", {
      provider: input.env.asrProvider,
      model: input.env.asrModel,
    }, {
      provider: route.provider,
      model: route.model,
    }),
  });
}

function createTranslationProvider(
  input: Parameters<typeof createDefaultCallProviders>[0],
): CallTranslationProvider {
  const primary = new OpenAiCompatibleTranslationProvider({
    baseUrl: input.env.translationBaseUrl,
    model: input.env.translationModel,
    apiKey: input.env.translationApiKey,
    timeoutMs: input.env.translationTimeoutMs,
    maxTokens: input.env.translationMaxTokens,
    streaming: input.env.translationStreamingEnabled,
  });
  const route = input.env.translationFallback;
  if (!route) return primary;
  const fallback = new OpenAiCompatibleTranslationProvider({
    baseUrl: route.baseUrl,
    model: route.model,
    apiKey: route.apiKey,
    timeoutMs: route.timeoutMs,
    maxTokens: route.maxTokens,
    streaming: route.streaming,
  });
  return new FallbackTranslationProvider({
    primary,
    fallback,
    controller: controller(input, "translation", {
      provider: input.env.translationProvider,
      model: input.env.translationModel,
    }, {
      provider: route.provider,
      model: route.model,
    }),
  });
}

function createTtsProvider(
  input: Parameters<typeof createDefaultCallProviders>[0],
): CallTtsProvider | undefined {
  if (!input.env.ttsHttpEndpoint) return undefined;
  const primary = new HttpTtsProvider({
    endpoint: input.env.ttsHttpEndpoint,
    streamEndpoint: input.env.ttsStreamEndpoint,
    warmupEndpoint: input.env.ttsWarmupEndpoint,
    warmupMaxMs: input.env.ttsWarmupMaxMs,
    apiKey: input.env.ttsHttpApiKey,
    timeoutMs: input.env.ttsHttpTimeoutMs,
    provider: input.env.ttsProvider,
    model: input.env.ttsModel,
    voice: input.env.ttsVoice,
  });
  const route = input.env.ttsFallback;
  if (!route) return primary;
  const fallback = new HttpTtsProvider({
    endpoint: route.endpoint,
    streamEndpoint: route.streamEndpoint,
    warmupEndpoint: route.warmupEndpoint,
    warmupMaxMs: input.env.ttsWarmupMaxMs,
    apiKey: route.apiKey,
    timeoutMs: route.timeoutMs,
    provider: route.provider,
    model: route.model,
    voice: input.env.ttsVoice,
  });
  return new FallbackTtsProvider({
    primary,
    fallback,
    controller: controller(input, "tts", {
      provider: input.env.ttsProvider ?? "http_tts",
      model: input.env.ttsModel,
    }, {
      provider: route.provider,
      model: route.model,
    }),
  });
}

function controller(
  input: Parameters<typeof createDefaultCallProviders>[0],
  stage: "asr" | "translation" | "tts",
  primary: { provider: string; model?: string },
  fallback: { provider: string; model?: string },
) {
  return new StickyProviderFallbackController({
    stage,
    primary,
    fallback,
    ...input.env.providerFallback,
    onTransition: input.onTransition,
  });
}
