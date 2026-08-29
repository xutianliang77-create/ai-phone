import type { RealtimeEnv } from "../config/env.js";
import { createLlmProvider, type LlmConfig } from "@translation/llm";
import { HttpAsrProvider } from "../asr/http-asr-provider.js";
import { MockAsrProvider } from "../asr/mock-asr-provider.js";
import type { AsrProvider } from "../asr/asr-provider.js";
import { SpeakerAwareAsrProvider } from "../asr/speaker-aware-asr-provider.js";
import { HttpSpeakerAttributionProvider } from "../speaker/http-speaker-attribution-provider.js";
import { ApiVoiceIdentityMatcher } from "../speaker/voice-identity-matcher.js";
import { HttpSpeakerRevisionProvider } from
  "../speaker/http-speaker-revision-provider.js";
import { SpeakerRevisionRealtimeProvider } from
  "../speaker/speaker-revision-realtime-provider.js";
import type { RealtimeProvider } from "./realtime-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio/lmstudio-realtime-provider.js";
import { MockRealtimeProvider } from "./mock-realtime-provider.js";
import { OpenAiRealtimeProvider } from "./openai/openai-realtime-provider.js";

export class ProviderRouter {
  selectProvider(env?: RealtimeEnv): RealtimeProvider {
    if (env?.provider === "tencent_trtc") {
      throw new Error("REALTIME_PROVIDER=tencent_trtc is not implemented yet");
    }
    if (env?.resolvedProvider === "openai") {
      if (!env.openAiApiKey) {
        throw new Error("OPENAI_API_KEY is required when REALTIME_PROVIDER=openai");
      }
      return new OpenAiRealtimeProvider({
        apiKey: env.openAiApiKey,
        endpoint: env.openAiRealtimeEndpoint,
        model: env.openAiRealtimeModel,
        inputTranscriptionModel: env.openAiInputTranscriptionModel,
        connectTimeoutMs: env.openAiConnectTimeoutMs,
      });
    }
    if (env?.resolvedProvider === "lmstudio") {
      return withSpeakerRevision(new LmStudioRealtimeProvider({
        providerName: selfHostedProviderName(env.provider),
        baseUrl: env.lmStudioBaseUrl,
        model: env.lmStudioModel,
        apiKey: env.lmStudioApiKey,
        timeoutMs: env.lmStudioTimeoutMs,
        maxTokens: env.lmStudioMaxTokens,
        asrProvider: createAsrProvider(env),
        asrRefinementProvider: createLlmProvider(llmConfigFromEnv(env)),
        asrRefinementEnabled: env.llmRefinementEnabled,
        asrRefinementMinConfidence: env.llmMinConfidence,
        listeningMaxContinuationBufferMs:
          env.listeningMaxContinuationBufferMs,
      }), env);
    }
    if (env?.resolvedProvider === "qwen_live") {
      assertQwenLiveConfig(env);
      return withSpeakerRevision(new LmStudioRealtimeProvider({
        providerName: "qwen_live",
        baseUrl: env.qwenBaseUrl,
        model: env.qwenModel,
        apiKey: env.qwenApiKey,
        timeoutMs: env.qwenTimeoutMs,
        maxTokens: env.qwenMaxTokens,
        reasoningEffort: null,
        extraBody: { enable_thinking: false },
        asrProvider: createAsrProvider(env),
        asrRefinementProvider: createLlmProvider(llmConfigFromEnv(env)),
        asrRefinementEnabled: env.llmRefinementEnabled,
        asrRefinementMinConfidence: env.llmMinConfidence,
        listeningMaxContinuationBufferMs:
          env.listeningMaxContinuationBufferMs,
      }), env);
    }
    return new MockRealtimeProvider();
  }
}

function withSpeakerRevision(
  provider: RealtimeProvider,
  env: RealtimeEnv,
): RealtimeProvider {
  if (env.speakerRevisionProvider !== "http") return provider;
  if (!env.speakerRevisionHttpEndpoint) {
    throw new Error(
      "SPEAKER_REVISION_HTTP_ENDPOINT is required when " +
        "SPEAKER_REVISION_PROVIDER=http",
    );
  }
  return new SpeakerRevisionRealtimeProvider(
    provider,
    new HttpSpeakerRevisionProvider({
      endpoint: env.speakerRevisionHttpEndpoint,
      healthUrl: env.speakerRevisionHealthUrl,
      apiKey: env.speakerRevisionHttpApiKey,
      timeoutMs: env.speakerRevisionHttpTimeoutMs,
    }),
    {
      mode: env.speakerRevisionMode,
      maxWindowMs: env.speakerRevisionWindowMs,
      tokenSplitEnabled: env.speakerRevisionTokenSplitEnabled,
    },
  );
}

function llmConfigFromEnv(env: RealtimeEnv): LlmConfig {
  return {
    provider: env.llmProvider,
    baseUrl: env.llmBaseUrl,
    apiKey: env.llmApiKey,
    correctionModel: env.llmCorrectionModel,
    reviewModel: env.llmReviewModel,
    refinementEnabled: env.llmRefinementEnabled,
    reviewEnabled: env.llmReviewEnabled,
    correctionTimeoutMs: env.llmCorrectionTimeoutMs,
    reviewTimeoutMs: env.llmReviewTimeoutMs,
    correctionMaxTokens: env.llmCorrectionMaxTokens,
    reviewMaxTokens: env.llmReviewMaxTokens,
    temperature: env.llmTemperature,
    reasoningEffort: env.llmReasoningEffort,
    minConfidence: env.llmMinConfidence,
  };
}

function selfHostedProviderName(provider: RealtimeEnv["provider"]) {
  if (provider === "self_hosted" || provider === "hymt2_self_hosted") {
    return provider;
  }
  return undefined;
}

function assertQwenLiveConfig(env: RealtimeEnv) {
  if (!env.qwenApiKey) {
    throw new Error("QWEN_API_KEY is required when REALTIME_PROVIDER=qwen_live");
  }
  if (!env.qwenBaseUrl) {
    throw new Error("QWEN_BASE_URL is required when REALTIME_PROVIDER=qwen_live");
  }
  if (!env.qwenModel) {
    throw new Error("QWEN_MODEL is required when REALTIME_PROVIDER=qwen_live");
  }
}

function createAsrProvider(env: RealtimeEnv): AsrProvider {
  const provider = createBaseAsrProvider(env);
  if (env.speakerProvider !== "http") return provider;
  if (!env.speakerHttpBaseUrl) {
    throw new Error(
      "SPEAKER_HTTP_BASE_URL is required when SPEAKER_PROVIDER=http",
    );
  }
  return new SpeakerAwareAsrProvider(
    provider,
    new HttpSpeakerAttributionProvider({
      baseUrl: env.speakerHttpBaseUrl,
      apiKey: env.speakerHttpApiKey,
      timeoutMs: env.speakerHttpTimeoutMs,
    }),
    undefined,
    new ApiVoiceIdentityMatcher({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.speakerHttpTimeoutMs,
    }),
  );
}

function createBaseAsrProvider(env: RealtimeEnv): AsrProvider {
  if (env.asrProvider === "http") {
    if (!env.asrHttpEndpoint) {
      throw new Error("ASR_HTTP_ENDPOINT is required when ASR_PROVIDER=http");
    }
    return new HttpAsrProvider({
      endpoint: env.asrHttpEndpoint,
      flushEndpoint: env.asrHttpFlushEndpoint,
      healthUrl: env.asrHttpHealthUrl,
      apiKey: env.asrHttpApiKey,
      timeoutMs: env.asrHttpTimeoutMs,
    });
  }
  return new MockAsrProvider();
}
