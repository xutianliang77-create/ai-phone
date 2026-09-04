import {
  boundedInteger,
  parseBoolean,
  parseSpeakerRevisionMode,
  parseSpeakerRevisionProvider,
} from "./env-parsers.js";

export interface SpeakerRevisionEnv {
  speakerRevisionProvider: "off" | "http";
  speakerRevisionMode: "shadow" | "apply";
  speakerRevisionHttpEndpoint?: string;
  speakerRevisionHealthUrl?: string;
  speakerRevisionHttpApiKey?: string;
  speakerRevisionHttpTimeoutMs: number;
  speakerRevisionWindowMs: number;
  speakerRevisionTokenSplitEnabled: boolean;
}

export function loadSpeakerRevisionEnv(
  env: Record<string, string | undefined>,
): SpeakerRevisionEnv {
  return {
    speakerRevisionProvider: parseSpeakerRevisionProvider(
      env.SPEAKER_REVISION_PROVIDER,
    ),
    speakerRevisionMode: parseSpeakerRevisionMode(
      env.SPEAKER_REVISION_MODE,
    ),
    speakerRevisionHttpEndpoint: env.SPEAKER_REVISION_HTTP_ENDPOINT,
    speakerRevisionHealthUrl: env.SPEAKER_REVISION_HEALTH_URL,
    speakerRevisionHttpApiKey: env.SPEAKER_REVISION_HTTP_API_KEY,
    speakerRevisionHttpTimeoutMs: boundedInteger(
      env.SPEAKER_REVISION_HTTP_TIMEOUT_MS,
      15_000,
      500,
      120_000,
    ),
    speakerRevisionWindowMs: boundedInteger(
      env.SPEAKER_REVISION_WINDOW_MS,
      90_000,
      5_000,
      90_000,
    ),
    speakerRevisionTokenSplitEnabled: parseBoolean(
      env.SPEAKER_REVISION_TOKEN_SPLIT_ENABLED,
      false,
    ),
  };
}
