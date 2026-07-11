import pino from "pino";
import { loadEnv } from "./config/env.js";
import { HttpAsrProvider } from "./providers/http-asr-provider.js";
import { HttpTtsAudioSink } from "./providers/http-tts-audio-sink.js";
import { HttpTtsProvider } from "./providers/http-tts-provider.js";
import { OpenAiCompatibleTranslationProvider } from "./providers/openai-compatible-translation-provider.js";
import { HttpCallRoomEventClient } from "./worker/call-room-event-client.js";
import { HttpCallRoomTokenClient } from "./worker/call-room-token-client.js";
import { CallTranslationWorker } from "./worker/call-translation-worker.js";
import { LiveKitCallAudioSource } from "./worker/livekit-call-audio-source.js";

const logger = pino({ name: "translation-worker" });

export function buildDefaultWorker() {
  const env = loadEnv();
  return new CallTranslationWorker({
    asrProvider: new HttpAsrProvider({
      endpoint: env.asrHttpEndpoint,
      flushEndpoint: env.asrHttpFlushEndpoint,
      apiKey: env.asrHttpApiKey,
      timeoutMs: env.asrHttpTimeoutMs,
    }),
    translationProvider: new OpenAiCompatibleTranslationProvider({
      baseUrl: env.translationBaseUrl,
      model: env.translationModel,
      apiKey: env.translationApiKey,
      timeoutMs: env.translationTimeoutMs,
      maxTokens: env.translationMaxTokens,
    }),
    ttsProvider: env.ttsHttpEndpoint
      ? new HttpTtsProvider({
        endpoint: env.ttsHttpEndpoint,
        apiKey: env.ttsHttpApiKey,
        timeoutMs: env.ttsHttpTimeoutMs,
        provider: env.ttsProvider,
        model: env.ttsModel,
        voice: env.ttsVoice,
      })
      : undefined,
    ttsAudioSink: env.ttsAudioSinkEndpoint
      ? new HttpTtsAudioSink({
        endpoint: env.ttsAudioSinkEndpoint,
        apiKey: env.ttsAudioSinkApiKey,
        timeoutMs: env.ttsAudioSinkTimeoutMs,
      })
      : undefined,
    eventSink: new HttpCallRoomEventClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    }),
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
    worker: buildDefaultWorker(),
    audioSampleRate: env.audioSampleRate,
    audioFrameSizeMs: env.audioFrameSizeMs,
    tokenClient: new HttpCallRoomTokenClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
      participantName: env.participantName,
    }),
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
