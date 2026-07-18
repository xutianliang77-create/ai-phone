import { createHash } from "node:crypto";
import type {
  AsrEndpointMode,
  RealtimeModelFingerprintDto,
  RealtimeNodeDiagnosticsDto,
} from "@translation/contracts";
import type { TranslationWorkerEnv } from "../config/env.js";
import type { LiveKitCallDiagnosticsSnapshot } from
  "./livekit-call-audio-source-types.js";

export function buildRealtimeNodeDiagnostics(
  env: TranslationWorkerEnv,
  snapshot: LiveKitCallDiagnosticsSnapshot,
  identity: {
    runtimeId: string;
    startedAtMs: number;
    endedAtMs: number;
    generation?: number;
    endpointMode?: AsrEndpointMode;
  },
): RealtimeNodeDiagnosticsDto {
  return {
    nodeId: env.diagnosticsNodeId,
    runtimeId: identity.runtimeId,
    ...(identity.generation === undefined ? {} : { generation: identity.generation }),
    startedAtMs: identity.startedAtMs,
    endedAtMs: identity.endedAtMs,
    audioLegs: snapshot.audioLegs,
    ...(snapshot.rtc ? { rtc: snapshot.rtc } : {}),
    modelFingerprints: workerModelFingerprints(
      env,
      identity.endpointMode ?? "call_link",
    ),
  };
}

export function workerModelFingerprints(
  env: TranslationWorkerEnv,
  endpointMode: AsrEndpointMode,
): RealtimeModelFingerprintDto[] {
  const profile = env.modelRoutingProfile;
  const entries: Array<Omit<RealtimeModelFingerprintDto, "fingerprint"> & {
    parameters: unknown;
  }> = [
    {
      stage: "pipeline",
      provider: env.speechPipelineMode,
      ...(profile ? { profile } : {}),
      parameters: {
        audioSampleRate: env.audioSampleRate,
        audioFrameSizeMs: env.audioFrameSizeMs,
        audioIngestMaxFrames: env.audioIngestMaxFrames,
        duplex: env.duplexConfig,
        providerFallback: env.providerFallback,
        llmFallbackCooldownMs: env.llmFallbackCooldownMs,
        endDrainGraceMs: env.pipelineEndGraceMs,
      },
    },
    {
      stage: "asr",
      provider: env.asrProvider,
      ...(env.asrModel ? { model: env.asrModel } : {}),
      ...(profile ? { profile } : {}),
      parameters: {
        endpointMode,
        streaming: Boolean(env.asrStreamEndpoint),
        streamFallbackToHttp: env.asrStreamFallbackToHttp,
        timeoutMs: env.asrHttpTimeoutMs,
        domainLexiconPacks: env.domainLexiconPacks,
        fallback: env.asrFallback
          ? {
            provider: env.asrFallback.provider,
            model: env.asrFallback.model,
            streaming: Boolean(env.asrFallback.streamEndpoint),
            timeoutMs: env.asrFallback.timeoutMs,
          }
          : undefined,
      },
    },
    {
      stage: "translation",
      provider: env.translationProvider,
      model: env.translationModel,
      ...(profile ? { profile } : {}),
      parameters: {
        streaming: env.translationStreamingEnabled,
        timeoutMs: env.translationTimeoutMs,
        maxTokens: env.translationMaxTokens,
        fallback: env.translationFallback
          ? {
            provider: env.translationFallback.provider,
            model: env.translationFallback.model,
            streaming: env.translationFallback.streaming,
            timeoutMs: env.translationFallback.timeoutMs,
            maxTokens: env.translationFallback.maxTokens,
          }
          : undefined,
      },
    },
  ];
  if (env.ttsProvider || env.ttsModel || env.ttsHttpEndpoint) {
    entries.push({
      stage: "tts",
      provider: env.ttsProvider ?? "http_tts",
      ...(env.ttsModel ? { model: env.ttsModel } : {}),
      ...(profile ? { profile } : {}),
      parameters: {
        streaming: Boolean(env.ttsStreamEndpoint),
        timeoutMs: env.ttsHttpTimeoutMs,
        warmupMaxMs: env.ttsWarmupMaxMs,
        voiceMode: env.ttsVoice?.mode,
        quality: env.ttsVoice?.quality,
        fallback: env.ttsFallback
          ? {
            provider: env.ttsFallback.provider,
            model: env.ttsFallback.model,
            streaming: Boolean(env.ttsFallback.streamEndpoint),
            timeoutMs: env.ttsFallback.timeoutMs,
          }
          : undefined,
      },
    });
  }
  return entries.map(({ parameters, ...entry }) => ({
    ...entry,
    fingerprint: sha256({ ...entry, parameters }),
  }));
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
