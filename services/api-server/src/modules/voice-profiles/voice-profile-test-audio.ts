import { getReadyVoiceProfileTtsConfig } from "./voice-profiles.service.js";

type TestAudioLanguage = "zh" | "en";

interface TtsAudioPayload {
  format: "pcm16";
  sampleRate: 16000 | 24000;
  data: string;
}

interface VoiceTestAudioResponse {
  text: string;
  language: TestAudioLanguage;
  provider: string;
  model: string;
  voiceMode: string;
  voiceProfileId?: string;
  variant: "natural" | "clone";
  audio: TtsAudioPayload;
}

type VoiceTestAudioResult =
  | { ok: true; response: VoiceTestAudioResponse }
  | { ok: false; statusCode: 409 | 503; code: string; message: string };

const defaultTextByLanguage: Record<TestAudioLanguage, string> = {
  zh: "你好，这是我的声音试听。",
  en: "Hello, this is a preview of my voice.",
};

export async function synthesizeMyVoiceTestAudio(
  userId: string,
  body: Record<string, unknown>,
): Promise<VoiceTestAudioResult> {
  const voice = getReadyVoiceProfileTtsConfig(userId);
  if (!voice) {
    return failure(409, "voice_profile_not_ready", "voice profile is not ready");
  }
  const endpoint = process.env.TTS_HTTP_ENDPOINT;
  if (!endpoint) {
    return failure(503, "tts_service_not_configured", "TTS service is not configured");
  }

  const language = body.language === "en" ? "en" : "zh";
  const variant = body.variant === "natural" ? "natural" : "clone";
  const text = cleanText(body.text, 120) || defaultTextByLanguage[language];
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: ttsHeaders(),
      body: JSON.stringify({
        text,
        language,
        speakerRole: "guest",
        segmentId: `voice-test-${voice.voiceProfileId}`,
        voice: variant === "clone" ? { ...voice, quality: "hifi" } : { mode: "preset" },
      }),
    });
    if (!response.ok) {
      return failure(503, "tts_synthesis_failed", `TTS returned HTTP ${response.status}`);
    }
    const payload = parseTtsResponse(await response.json());
    if (!payload) {
      return failure(503, "tts_audio_unplayable", "TTS returned no playable audio");
    }
    return {
      ok: true,
      response: {
        text,
        language,
        variant,
        ...payload,
      },
    };
  } catch (error) {
    return failure(503, "tts_synthesis_failed", errorMessage(error));
  }
}

function parseTtsResponse(
  value: unknown,
): Omit<VoiceTestAudioResponse, "text" | "language" | "variant"> | null {
  const object = asObject(value);
  const audio = asObject(object?.audio);
  const format = audio?.format;
  const sampleRate = audio?.sampleRate;
  const data = audio?.data;
  if (
    format !== "pcm16" ||
    (sampleRate !== 16000 && sampleRate !== 24000) ||
    typeof data !== "string" ||
    !data
  ) {
    return null;
  }
  const playableAudio: TtsAudioPayload = { format: "pcm16", sampleRate, data };
  return {
    provider: stringValue(object?.provider, "tts-service"),
    model: stringValue(object?.model, "unknown"),
    voiceMode: stringValue(object?.voiceMode, "personal_clone"),
    ...(typeof object?.voiceProfileId === "string"
      ? { voiceProfileId: object.voiceProfileId }
      : {}),
    audio: playableAudio,
  };
}

function ttsHeaders() {
  return {
    "content-type": "application/json",
    ...(process.env.TTS_HTTP_API_KEY
      ? { authorization: `Bearer ${process.env.TTS_HTTP_API_KEY}` }
      : {}),
  };
}

function failure(
  statusCode: 409 | 503,
  code: string,
  message: string,
): VoiceTestAudioResult {
  return { ok: false, statusCode, code, message };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
