import pino from "pino";
import type { AsrEndpointMode } from "@translation/contracts";
import { createLlmProvider } from "@translation/llm";
import {
  asrCorrectionTermsForPacks,
  asrHotwordsForTerminology,
  domainTerminologyForPacks,
} from "@translation/speech-quality";
import { loadEnv } from "./config/env.js";
import { HttpAsrProvider } from "./providers/http-asr-provider.js";
import { HttpTtsAudioSink } from "./providers/http-tts-audio-sink.js";
import { HttpTtsProvider } from "./providers/http-tts-provider.js";
import { OpenAiCompatibleTranslationProvider } from "./providers/openai-compatible-translation-provider.js";
import { HttpCallRoomEventClient } from "./worker/call-room-event-client.js";
import { HttpCallRoomTokenClient } from "./worker/call-room-token-client.js";
import { HttpCallSipStatusClient } from "./worker/call-sip-status-client.js";
import { HttpCallTtsTrackAccessClient } from "./worker/call-tts-track-access-client.js";
import { CallTranslationWorker } from "./worker/call-translation-worker.js";
import { CallTranscriptRefiner } from "./worker/call-transcript-refiner.js";
import { LiveKitCallAudioSource } from "./worker/livekit-call-audio-source.js";
import type { AudioIngestMetrics } from "./worker/audio-ingest-ring-buffer.js";
import { SpeechPipelineRouter } from "./worker/speech-pipeline-router.js";
import type {
  CallRoomEventSink,
  CallSpeechPipeline,
  SpeechToSpeechProvider,
} from "./worker/types.js";

const logger = pino({ name: "translation-worker" });

export function buildDefaultWorker(
  endpointMode: AsrEndpointMode = "call_link",
  options: { eventSink?: CallRoomEventSink; ttsEnabled?: boolean } = {},
) {
  const env = loadEnv();
  const terminology = domainTerminologyForPacks(env.domainLexiconPacks);
  const corrections = asrCorrectionTermsForPacks(env.domainLexiconPacks);
  return new CallTranslationWorker({
    asrProvider: new HttpAsrProvider({
      endpoint: env.asrHttpEndpoint,
      flushEndpoint: env.asrHttpFlushEndpoint,
      streamEndpoint: env.asrStreamEndpoint,
      streamFallbackToHttp: env.asrStreamFallbackToHttp,
      apiKey: env.asrHttpApiKey,
      timeoutMs: env.asrHttpTimeoutMs,
      endpointMode,
      hotwords: asrHotwordsForTerminology(terminology, corrections),
      corrections,
    }),
    translationProvider: new OpenAiCompatibleTranslationProvider({
      baseUrl: env.translationBaseUrl,
      model: env.translationModel,
      apiKey: env.translationApiKey,
      timeoutMs: env.translationTimeoutMs,
      maxTokens: env.translationMaxTokens,
      streaming: env.translationStreamingEnabled,
    }),
    ttsProvider: options.ttsEnabled !== false && env.ttsHttpEndpoint
      ? new HttpTtsProvider({
        endpoint: env.ttsHttpEndpoint,
        streamEndpoint: env.ttsStreamEndpoint,
        warmupEndpoint: env.ttsWarmupEndpoint,
        warmupMaxMs: env.ttsWarmupMaxMs,
        apiKey: env.ttsHttpApiKey,
        timeoutMs: env.ttsHttpTimeoutMs,
        provider: env.ttsProvider,
        model: env.ttsModel,
        voice: env.ttsVoice,
      })
      : undefined,
    ttsAudioSink: options.ttsEnabled !== false && env.ttsAudioSinkEndpoint
      ? new HttpTtsAudioSink({
        endpoint: env.ttsAudioSinkEndpoint,
        interruptEndpoint: env.ttsAudioSinkInterruptEndpoint,
        apiKey: env.ttsAudioSinkApiKey,
        timeoutMs: env.ttsAudioSinkTimeoutMs,
      })
      : undefined,
    eventSink: options.eventSink ?? new HttpCallRoomEventClient({
        apiBaseUrl: env.apiBaseUrl,
        internalApiSecret: env.internalApiSecret,
        timeoutMs: env.apiTimeoutMs,
      }),
    transcriptRefiner: new CallTranscriptRefiner({
      provider: createLlmProvider(env.llmConfig),
      enabled: env.llmConfig.refinementEnabled,
      minConfidence: env.llmConfig.minConfidence,
      terminology,
    }),
    duplexConfig: env.duplexConfig,
    terminology,
  });
}

export function buildDefaultSpeechPipeline(
  endpointMode: AsrEndpointMode = "call_link",
  native?: SpeechToSpeechProvider,
): CallSpeechPipeline {
  const env = loadEnv();
  return new SpeechPipelineRouter({
    mode: env.speechPipelineMode,
    cascade: buildDefaultWorker(endpointMode),
    ...(native ? { native } : {}),
    onShadowError: (error) => {
      logger.warn({ err: error }, "Native speech shadow pipeline failed");
    },
  });
}

async function main() {
  const env = loadEnv();
  if (!env.callId) {
    logger.info("Translation Worker core is ready; set TRANSLATION_WORKER_CALL_ID.");
    return;
  }

  const source = new LiveKitCallAudioSource({
    callId: env.callId,
    worker: buildDefaultSpeechPipeline(),
    audioSampleRate: env.audioSampleRate,
    audioFrameSizeMs: env.audioFrameSizeMs,
    audioIngestMaxFrames: env.audioIngestMaxFrames,
    tokenClient: new HttpCallRoomTokenClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
      participantName: env.participantName,
    }),
    sipStatusClient: new HttpCallSipStatusClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    }),
    ttsTrackAccessClient: new HttpCallTtsTrackAccessClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    }),
    onError: (error) =>
      logger.warn({ err: error }, "Translation audio source failed"),
    onCallEnded: (error) => logger.info({
      callId: error.callId,
      code: error.code,
    }, "Translation worker stopped after call ended"),
    onIngestMetrics: (metrics) =>
      logAudioIngestMetrics(metrics, env.audioFrameSizeMs),
  });
  process.once("SIGINT", () => void source.stop());
  process.once("SIGTERM", () => void source.stop());
  const token = await source.start();
  logger.info({ callId: env.callId, roomName: token.roomName }, "Translation Worker joined call room.");
  await source.waitUntilDisconnected();
}

export function isTranslationWorkerEntrypoint(argv = process.argv) {
  return argv.some((arg) =>
    arg.endsWith("services/translation-worker/src/main.ts") ||
    arg.endsWith("src/main.ts") ||
    arg.endsWith("services/translation-worker/dist/main.js") ||
    arg.endsWith("dist/main.js")
  );
}

if (isTranslationWorkerEntrypoint()) {
  main().catch((error) => {
    logger.error({ err: error }, "Translation Worker failed");
    process.exitCode = 1;
  });
}

function logAudioIngestMetrics(
  metrics: AudioIngestMetrics,
  audioFrameSizeMs: number,
) {
  const data = {
    ...metrics,
    capacityAudioMs: metrics.capacityFrames * audioFrameSizeMs,
  };
  if (metrics.event === "backpressure") {
    if (metrics.backpressureEvents !== 1 && metrics.backpressureEvents % 25 !== 0) {
      return;
    }
    logger.warn(data, "Audio ingest backpressure dropped stale frames");
    return;
  }
  if (metrics.event === "sequence_gap") {
    logger.warn(data, "Audio ingest sequence gap observed");
    return;
  }
  if (metrics.event === "drained" || metrics.event === "stopped") {
    logger.info(data, "Audio ingest leg completed");
    return;
  }
  logger.debug(data, "Audio ingest high watermark changed");
}
