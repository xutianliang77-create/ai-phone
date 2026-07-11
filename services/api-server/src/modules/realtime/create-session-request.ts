import {
  isSupportedLanguage,
  isTranslationLanguage,
} from "@translation/contracts";
import type {
  CreateRealtimeSessionRequest,
  RealtimeMode,
  RealtimeVoiceConfig,
  RealtimeVoiceMode,
} from "@translation/contracts";

const modes = new Set<RealtimeMode>([
  "conversation",
  "meeting",
  "classroom",
  "business",
]);
const voiceModes = new Set<RealtimeVoiceMode>([
  "preset",
  "voice_design",
  "personal_clone",
  "ultimate_clone",
]);
const voiceIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

interface ValidationError {
  code: string;
  message: string;
}

type ValidationResult =
  | { ok: true; value: CreateRealtimeSessionRequest }
  | { ok: false; error: ValidationError };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function validateCreateRealtimeSessionRequest(
  input: unknown,
): ValidationResult {
  if (!isRecord(input)) {
    return invalid("Request body must be an object");
  }

  const mode = input.mode;
  const sourceLanguage = input.sourceLanguage;
  const targetLanguage = input.targetLanguage;
  const autoReverseTargetLanguage = input.autoReverseTargetLanguage;
  const voiceOutput = input.voiceOutput;
  const voice = input.voice;
  const termbaseId = input.termbaseId;

  if (typeof mode !== "string" || !modes.has(mode as RealtimeMode)) {
    return invalid("mode must be conversation, meeting, classroom, or business");
  }
  if (
    typeof sourceLanguage !== "string" ||
    !isSupportedLanguage(sourceLanguage)
  ) {
    return invalid("sourceLanguage must be auto or a supported language");
  }
  if (
    typeof targetLanguage !== "string" ||
    !isTranslationLanguage(targetLanguage)
  ) {
    return invalid("targetLanguage must be a supported translation language");
  }
  if (sourceLanguage === targetLanguage) {
    return invalid("sourceLanguage and targetLanguage must be different");
  }
  if (
    autoReverseTargetLanguage !== undefined &&
    typeof autoReverseTargetLanguage !== "boolean"
  ) {
    return invalid("autoReverseTargetLanguage must be boolean when provided");
  }
  if (typeof voiceOutput !== "boolean") {
    return invalid("voiceOutput must be boolean");
  }
  const parsedVoice = parseVoiceConfig(voice);
  if (parsedVoice === false) {
    return invalid("voice must be a valid realtime voice config");
  }
  if (termbaseId !== undefined && typeof termbaseId !== "string") {
    return invalid("termbaseId must be string when provided");
  }

  return {
    ok: true,
    value: {
      mode: mode as RealtimeMode,
      sourceLanguage,
      targetLanguage,
      ...(autoReverseTargetLanguage ? { autoReverseTargetLanguage } : {}),
      voiceOutput,
      ...(parsedVoice ? { voice: parsedVoice } : {}),
      ...(termbaseId ? { termbaseId } : {}),
    },
  };
}

function parseVoiceConfig(value: unknown): RealtimeVoiceConfig | null | false {
  if (value === undefined) return null;
  if (!isRecord(value)) return false;
  const mode = value.mode;
  if (typeof mode !== "string" || !voiceModes.has(mode as RealtimeVoiceMode)) {
    return false;
  }
  const voiceProfileId = optionalVoiceId(value.voiceProfileId);
  const referenceAudioId = optionalVoiceId(value.referenceAudioId);
  const referenceTranscript = optionalText(value.referenceTranscript, 1000);
  const controlPrompt = optionalText(value.controlPrompt, 240);
  if (
    (value.voiceProfileId !== undefined && !voiceProfileId) ||
    (value.referenceAudioId !== undefined && !referenceAudioId) ||
    (value.referenceTranscript !== undefined && !referenceTranscript) ||
    (value.controlPrompt !== undefined && !controlPrompt)
  ) {
    return false;
  }
  return {
    mode: mode as RealtimeVoiceMode,
    ...(voiceProfileId ? { voiceProfileId } : {}),
    ...(referenceAudioId ? { referenceAudioId } : {}),
    ...(referenceTranscript ? { referenceTranscript } : {}),
    ...(controlPrompt ? { controlPrompt } : {}),
  };
}

function optionalVoiceId(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && voiceIdPattern.test(cleaned) ? cleaned : null;
}

function optionalText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : null;
}

function invalid(message: string): ValidationResult {
  return {
    ok: false,
    error: {
      code: "invalid_realtime_session_request",
      message,
    },
  };
}
