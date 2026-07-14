import type { TtsAudioSinkRequest } from "./types.js";

export function parseTranslatedAudioRequest(input: unknown): TtsAudioSinkRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const callId = text(body.callId, 120);
  const sessionId = text(body.sessionId, 120);
  const segmentId = text(body.segmentId, 120);
  const playbackId = text(body.playbackId, 160);
  const generation = positiveInteger(body.generation);
  const sourceLegId = text(body.sourceLegId, 160);
  const targetLegId = text(body.targetLegId, 160);
  const sourceSpeakerRole = speakerRole(body.sourceSpeakerRole);
  const targetSpeakerRole = speakerRole(body.targetSpeakerRole);
  const language = languageCode(body.language);
  const audio = parseAudio(body.audio);
  if (!callId || sessionId !== callId || !segmentId || !playbackId ||
    !generation || !sourceLegId || !targetLegId || !sourceSpeakerRole ||
    !targetSpeakerRole || !language || !audio ||
    sourceSpeakerRole === targetSpeakerRole) return null;
  return {
    callId,
    sessionId,
    segmentId,
    playbackId,
    generation,
    sourceLegId,
    targetLegId,
    sourceSpeakerRole,
    targetSpeakerRole,
    language,
    audio,
    ...optionalText("providerCallId", body.providerCallId, 160),
    ...optionalText("mediaStreamId", body.mediaStreamId, 160),
    ...optionalText("provider", body.provider, 80),
    ...optionalText("model", body.model, 120),
    ...optionalNumber("firstAudioMs", body.firstAudioMs),
    ...optionalNumber("audioDurationMs", body.audioDurationMs),
  };
}

function parseAudio(input: unknown): TtsAudioSinkRequest["audio"] | null {
  if (!input || typeof input !== "object") return null;
  const audio = input as Record<string, unknown>;
  const data = text(audio.data, 2_000_000);
  const sampleRate = audio.sampleRate === 16000 || audio.sampleRate === 24000
    ? audio.sampleRate
    : null;
  return audio.format === "pcm16" && sampleRate && data
    ? { format: "pcm16", sampleRate, data }
    : null;
}

function optionalText(name: string, value: unknown, maxLength: number) {
  const valueText = text(value, maxLength);
  return valueText ? { [name]: valueText } : {};
}

function optionalNumber(name: string, value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [name]: value }
    : {};
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : "";
}

function speakerRole(value: unknown): TtsAudioSinkRequest["sourceSpeakerRole"] | null {
  return value === "host" || value === "guest" ? value : null;
}

function languageCode(value: unknown): TtsAudioSinkRequest["language"] | null {
  return value === "zh" || value === "en" ? value : null;
}
