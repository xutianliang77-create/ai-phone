import pino from "pino";
import type { AsrEndpointMode } from "@translation/contracts";
import { createLlmProvider } from "@translation/llm";
import {
  asrCorrectionTermsForPacks,
  asrHotwordsForTerminology,
  domainTerminologyForPacks,
} from "@translation/speech-quality";
import { loadEnv } from "./config/env.js";
import { createDefaultCallProviders } from "./providers/default-call-providers.js";
import { HttpTtsAudioSink } from "./providers/http-tts-audio-sink.js";
import { HttpCallRoomEventClient } from "./worker/call-room-event-client.js";
import { HttpCallRoomTokenClient } from "./worker/call-room-token-client.js";
import { HttpCallSipStatusClient } from "./worker/call-sip-status-client.js";
import { HttpCallTtsTrackAccessClient } from "./worker/call-tts-track-access-client.js";
import { HttpCallInputTrackAccessClient } from
  "./worker/call-input-track-access-client.js";
import { CallTranslationWorker } from "./worker/call-translation-worker.js";
import { CallTranscriptRefiner } from "./worker/call-transcript-refiner.js";
import {
  CallDiagnosticsReporter,
  HttpCallDiagnosticsClient,
} from "./worker/call-diagnostics-client.js";
import { LiveKitCallAudioSource } from "./worker/livekit-call-audio-source.js";
import type { AudioIngestMetrics } from "./worker/audio-ingest-ring-buffer.js";
import { SpeechPipelineRouter } from "./worker/speech-pipeline-router.js";
import { callWorkerStatusEvent as statusEvent } from
  "./worker/call-worker-runtime-events.js";
import type { ProviderFallbackTransition } from
  "./worker/provider-fallback-controller.js";
import type {
  CallSpeechPipeline,
  CallTranslationControlPipeline,
  SpeechToSpeechProvider,
} from "./worker/types.js";

const logger = pino({ name: "translation-worker" });

export function buildDefaultWorker(endpointMode: AsrEndpointMode = "call_link") {
  const env = loadEnv();
  const terminology = domainTerminologyForPacks(env.domainLexiconPacks);
  const corrections = asrCorrectionTermsForPacks(env.domainLexiconPacks);
  const eventSink = new HttpCallRoomEventClient({
    apiBaseUrl: env.apiBaseUrl,
    internalApiSecret: env.internalApiSecret,
    timeoutMs: env.apiTimeoutMs,
  });
  const reportTransition = (transition: ProviderFallbackTransition) => {
    const restored = transition.state === "restored";
    logger[restored ? "info" : "warn"]({ transition },
      `Provider ${transition.state}`);
    return eventSink.publish(transition.callId, [statusEvent(
      `provider-${transition.state}-${transition.stage}`,
      restored
        ? `${providerStageName(transition.stage)}主 Provider 已恢复，新会话将使用主路由`
        : `${providerStageName(transition.stage)}已切换备用 Provider，本会话保持备用路由`,
      Date.now(),
      {
        stage: transition.stage === "llm" ? "asr" : transition.stage,
        provider: transition.to.provider,
        model: transition.to.model,
        retryable: !restored,
      },
    )]).then(() => undefined);
  };
  const providers = createDefaultCallProviders({
    env,
    endpointMode,
    hotwords: asrHotwordsForTerminology(terminology, corrections),
    corrections,
    onTransition: reportTransition,
  });
  return new CallTranslationWorker({
    ...providers,
    ttsAudioSink: env.ttsAudioSinkEndpoint
      ? new HttpTtsAudioSink({
        endpoint: env.ttsAudioSinkEndpoint,
        interruptEndpoint: env.ttsAudioSinkInterruptEndpoint,
        apiKey: env.ttsAudioSinkApiKey,
        timeoutMs: env.ttsAudioSinkTimeoutMs,
      })
      : undefined,
    eventSink,
    transcriptRefiner: new CallTranscriptRefiner({
      provider: createLlmProvider(env.llmConfig),
      enabled: env.llmConfig.refinementEnabled,
      minConfidence: env.llmConfig.minConfidence,
      terminology,
      fallbackCooldownMs: env.llmFallbackCooldownMs,
      onTransition: reportTransition,
    }),
    duplexConfig: env.duplexConfig,
    endDrainGraceMs: env.pipelineEndGraceMs,
    terminology,
  });
}

function providerStageName(stage: ProviderFallbackTransition["stage"]) {
  if (stage === "asr") return "语音识别";
  if (stage === "translation") return "翻译";
  if (stage === "tts") return "语音合成";
  return "LLM 校正";
}

export function buildDefaultSpeechPipeline(
  endpointMode: AsrEndpointMode = "call_link",
  native?: SpeechToSpeechProvider,
): CallSpeechPipeline & CallTranslationControlPipeline {
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

  const diagnostics = new CallDiagnosticsReporter({
    env,
    client: new HttpCallDiagnosticsClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    }),
  });

  const source = new LiveKitCallAudioSource({
    callId: env.callId,
    worker: buildDefaultSpeechPipeline(),
    audioSampleRate: env.audioSampleRate,
    audioFrameSizeMs: env.audioFrameSizeMs,
    audioIngestMaxFrames: env.audioIngestMaxFrames,
    rtcStatsIntervalMs: env.rtcStatsIntervalMs,
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
    inputTrackAccessClient: new HttpCallInputTrackAccessClient({
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
    onDiagnostics: (snapshot) => diagnostics.report(env.callId!, snapshot),
  });
  process.once("SIGINT", () => void source.stop());
  process.once("SIGTERM", () => void source.stop());
  try {
    const token = await source.start();
    logger.info({ callId: env.callId, roomName: token.roomName }, "Translation Worker joined call room.");
    await source.waitUntilDisconnected();
  } finally {
    await source.stop();
  }
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
    logger.warn(data, "Audio ingest backpressure requires controlled degradation");
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
