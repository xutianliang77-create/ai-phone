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
