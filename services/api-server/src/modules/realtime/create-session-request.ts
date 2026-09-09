import {
  isDomainLexiconPack,
  isSupportedLanguage,
  isTranslationLanguage,
  parseRealtimeProcessingRequest,
  processingMatchesSession,
} from "@translation/contracts";
import type {
  CreateRealtimeSessionRequest,
  DomainLexiconPack,
  RealtimeMode,
  RealtimeVoiceConfig,
  RealtimeVoiceMode,
  SpeakerAttributionMode,
  SpeakerAttributionOptionsDto,
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
const speakerModes = new Set<SpeakerAttributionMode>([
  "off",
  "auto",
  "participant_track",
  "diarization",
  "manual",
]);

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
  const domainLexiconPacks = input.domainLexiconPacks;
  const speakerAttribution = input.speakerAttribution;

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
  if (["processingMode", "processingContractVersion", "executionPlan",
    "modelPolicyRevision", "languagePolicy", "syncPermission", "publicGrantRef",
    "publicAccess"].some((key) => key in input)) {
    return invalid("Processing fields must use the versioned processing contract");
  }
  const processing = parseRealtimeProcessingRequest(input.processing);
  if (processing.status === "invalid") return invalid(processing.reason);
  if (processing.status === "valid" && !processingMatchesSession(processing.value, {
    sourceLanguage, targetLanguage, voiceOutput,
    autoReverseTargetLanguage: autoReverseTargetLanguage === true,
  })) return invalid("Processing language and voice settings must match the session");
  const parsedVoice = parseVoiceConfig(voice);
  if (parsedVoice === false) {
    return invalid("voice must be a valid realtime voice config");
  }
  if (termbaseId !== undefined && typeof termbaseId !== "string") {
    return invalid("termbaseId must be string when provided");
  }
  const parsedDomainLexiconPacks = parseDomainLexiconPacks(domainLexiconPacks);
  if (parsedDomainLexiconPacks === false) {
    return invalid("domainLexiconPacks must contain supported unique pack codes");
  }
  const parsedSpeakerAttribution = parseSpeakerAttribution(speakerAttribution);
  if (parsedSpeakerAttribution === false) {
    return invalid("speakerAttribution must be a valid speaker configuration");
  }
  const resolvedSpeakerAttribution = normalizeSpeakerAttribution(
    parsedSpeakerAttribution ?? defaultSpeakerAttribution(),
  );

  return {
    ok: true,
    value: {
      ...(processing.status === "valid" ? { processing: processing.value } : {}),
      mode: mode as RealtimeMode,
      sourceLanguage,
      targetLanguage,
      ...(autoReverseTargetLanguage ? { autoReverseTargetLanguage } : {}),
      voiceOutput,
      ...(parsedVoice ? { voice: parsedVoice } : {}),
      ...(termbaseId ? { termbaseId } : {}),
      ...(parsedDomainLexiconPacks
        ? { domainLexiconPacks: parsedDomainLexiconPacks }
        : {}),
      speakerAttribution: resolvedSpeakerAttribution,
    },
  };
}

function parseDomainLexiconPacks(
  value: unknown,
): DomainLexiconPack[] | null | false {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return false;
  if (!value.every((item) =>
    isDomainLexiconPack(item) && item !== "cultivation"
  )) return false;
  return [...new Set(value)];
}

function parseSpeakerAttribution(
  value: unknown,
): SpeakerAttributionOptionsDto | null | false {
  if (value === undefined) return null;
  if (!isRecord(value) || !speakerModes.has(value.mode as SpeakerAttributionMode)) {
    return false;
  }
  const maxSpeakers = value.maxSpeakers;
  if (maxSpeakers !== undefined &&
      maxSpeakers !== 2 && maxSpeakers !== 3 && maxSpeakers !== 4) {
    return false;
  }
  if (value.allowVoiceIdentity !== undefined &&
      typeof value.allowVoiceIdentity !== "boolean") {
    return false;
  }
  return {
    mode: value.mode as SpeakerAttributionMode,
    ...(maxSpeakers ? { maxSpeakers } : {}),
    ...(typeof value.allowVoiceIdentity === "boolean"
      ? { allowVoiceIdentity: value.allowVoiceIdentity }
      : {}),
  };
}

function defaultSpeakerAttribution(): SpeakerAttributionOptionsDto {
  return {
    mode: "auto",
    maxSpeakers: 4,
    allowVoiceIdentity: false,
  };
}

function normalizeSpeakerAttribution(
  options: SpeakerAttributionOptionsDto,
): SpeakerAttributionOptionsDto {
  if (options.mode === "participant_track") {
    return {
      mode: "participant_track",
      ...(typeof options.allowVoiceIdentity === "boolean"
        ? { allowVoiceIdentity: options.allowVoiceIdentity }
        : {}),
    };
  }
  if (options.mode === "auto" || options.mode === "diarization") {
    return { ...options, maxSpeakers: 4 };
  }
  return options;
}

function parseVoiceConfig(value: unknown): RealtimeVoiceConfig | null | false {
  if (value === undefined) return null;
  if (!isRecord(value)) return false;
  const mode = value.mode;
  if (typeof mode !== "string" || !voiceModes.has(mode as RealtimeVoiceMode)) {
    return false;
  }
  const presetId = optionalVoiceId(value.presetId);
  const voiceProfileId = optionalVoiceId(value.voiceProfileId);
  const referenceAudioId = optionalVoiceId(value.referenceAudioId);
  const referenceTranscript = optionalText(value.referenceTranscript, 1000);
  const controlPrompt = optionalText(value.controlPrompt, 240);
  const quality = value.quality === "hifi" ? "hifi" as const : "standard" as const;
  if (
    (value.presetId !== undefined && !presetId) ||
    (value.voiceProfileId !== undefined && !voiceProfileId) ||
    (value.referenceAudioId !== undefined && !referenceAudioId) ||
    (value.referenceTranscript !== undefined && !referenceTranscript) ||
    (value.controlPrompt !== undefined && !controlPrompt)
  ) {
    return false;
  }
  return {
    mode: mode as RealtimeVoiceMode,
    ...(presetId ? { presetId } : {}),
    ...(voiceProfileId ? { voiceProfileId } : {}),
    ...(referenceAudioId ? { referenceAudioId } : {}),
    ...(referenceTranscript ? { referenceTranscript } : {}),
    ...(controlPrompt ? { controlPrompt } : {}),
    quality,
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
