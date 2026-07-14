import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type { VoiceProfileRecord } from "./voice-profile-record.js";
import { syncVoiceReferenceAudio } from "./voice-reference-sync.js";
import { analyzeWavReference } from "./wav-reference-quality.js";

const maxReferenceAudioBytes = 10 * 1024 * 1024;

export function getMyVoiceProfile(userId: string) {
  return toVoiceProfileDto(findActiveVoiceProfile(userId));
}

export function getReadyVoiceProfileTtsConfig(userId: string) {
  const profile = findActiveVoiceProfile(userId);
  if (!profile || profile.status !== "ready" || !profile.referenceAudioId) {
    return undefined;
  }
  const referenceTranscript = cleanReferenceTranscript(
    profile.referenceTranscript,
  );
  return {
    mode: referenceTranscript ? "ultimate_clone" as const : profile.voiceMode,
    voiceProfileId: profile.id,
    referenceAudioId: profile.referenceAudioId,
    ...(referenceTranscript ? { referenceTranscript } : {}),
    quality: "hifi" as const,
  };
}

export function createMyVoiceProfile(
  userId: string,
  body: Record<string, unknown>,
) {
  if (body.consentAccepted !== true) {
    return { ok: false as const, code: "voice_consent_required" };
  }
  const consentVersion = cleanText(body.consentVersion, 100);
  if (!consentVersion) {
    return { ok: false as const, code: "invalid_consent_version" };
  }
  const now = new Date().toISOString();
  const existing = findActiveVoiceProfile(userId);
  const profile = existing ?? newVoiceProfile(userId, now);
  profile.displayName = cleanText(body.displayName, 80) || "我的声音";
  profile.consentVersion = consentVersion;
  profile.consentAcceptedAt = isoOrNow(body.consentAcceptedAt, now);
  profile.updatedAt = now;
  profile.status = profile.referenceAudioId
    ? "ready"
    : "pending_reference_audio";
  if (!existing) getStoreSnapshot().voiceProfiles.push(profile);
  persistStoreSnapshot();
  return { ok: true as const, profile: toVoiceProfileDto(profile)! };
}

export function deleteMyVoiceProfile(userId: string) {
  const profile = findActiveVoiceProfile(userId);
  if (!profile) return { ok: false as const, code: "voice_profile_not_found" };
  const now = new Date().toISOString();
  profile.status = "deleted";
  profile.deletedAt = now;
  profile.updatedAt = now;
  persistStoreSnapshot();
  return { ok: true as const, profile: toVoiceProfileDto(profile)! };
}

export async function attachVoiceProfileReferenceAudio(
  userId: string,
  body: Record<string, unknown>,
) {
  const profile = findActiveVoiceProfile(userId);
  if (!profile) return { ok: false as const, code: "voice_profile_not_found" };
  if (!isSupportedWavMime(body.mimeType)) {
    return { ok: false as const, code: "unsupported_reference_audio_type" };
  }
  const claimedDurationMs = numericDurationMs(body.durationMs);
  const audio = decodeReferenceAudio(body.audioBase64);
  if (!audio) return { ok: false as const, code: "invalid_reference_audio" };
  if (audio.byteLength > maxReferenceAudioBytes) {
    return { ok: false as const, code: "reference_audio_too_large" };
  }
  if (!isWav(audio)) {
    return { ok: false as const, code: "invalid_reference_audio_format" };
  }
  const quality = analyzeWavReference(audio);
  if (!quality) {
    return { ok: false as const, code: "invalid_reference_audio_format" };
  }
  const durationTolerance = Math.max(750, quality.durationMs * 0.2);
  if (Math.abs(claimedDurationMs - quality.durationMs) > durationTolerance) {
    return { ok: false as const, code: "reference_audio_duration_mismatch", quality };
  }
  if (!quality.accepted) {
    return { ok: false as const, code: quality.issues[0], quality };
  }

  const referenceAudioId = profile.id;
  mkdirSync(referenceAudioDir(), { recursive: true });
  writeFileSync(join(referenceAudioDir(), `${referenceAudioId}.wav`), audio);
  const syncResult = await syncVoiceReferenceAudio(referenceAudioId, audio);
  if (!syncResult.ok) {
    return {
      ok: false as const,
      code: "voice_reference_sync_failed",
      message: syncResult.message,
    };
  }

  const now = new Date().toISOString();
  profile.referenceAudioId = referenceAudioId;
  profile.referenceQuality = quality;
  const referenceTranscript = cleanReferenceTranscript(body.referenceTranscript);
  if (referenceTranscript) profile.referenceTranscript = referenceTranscript;
  else delete profile.referenceTranscript;
  profile.status = "ready";
  profile.updatedAt = now;
  persistStoreSnapshot();
  return { ok: true as const, profile: toVoiceProfileDto(profile)! };
}

function findActiveVoiceProfile(userId: string) {
  return (
    getStoreSnapshot()
      .voiceProfiles.filter(
        (profile) => profile.userId === userId && profile.status !== "deleted",
      )
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null
  );
}

function newVoiceProfile(userId: string, now: string): VoiceProfileRecord {
  return {
    id: randomUUID(),
    userId,
    displayName: "我的声音",
    status: "pending_reference_audio",
    voiceMode: "personal_clone",
    consentVersion: "",
    consentAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function toVoiceProfileDto(profile: VoiceProfileRecord | null) {
  if (!profile) return null;
  const referenceTranscript = cleanReferenceTranscript(
    profile.referenceTranscript,
  );
  return {
    id: profile.id,
    displayName: profile.displayName,
    status: profile.status,
    voiceMode: referenceTranscript ? "ultimate_clone" : profile.voiceMode,
    consentVersion: profile.consentVersion,
    consentAcceptedAt: profile.consentAcceptedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...(profile.referenceAudioId
      ? { referenceAudioId: profile.referenceAudioId }
      : {}),
    ...(referenceTranscript ? { referenceTranscript } : {}),
    ...(profile.referenceQuality ? { referenceQuality: profile.referenceQuality } : {}),
    ...(profile.deletedAt ? { deletedAt: profile.deletedAt } : {}),
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanReferenceTranscript(value: unknown) {
  return cleanText(value, 500)
    .replace(/^请用自然语速朗读[:：]\s*/u, "")
    .replace(/^Read naturally:\s*/iu, "")
    .trim();
}

function isoOrNow(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : fallback;
}

function numericDurationMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isSupportedWavMime(value: unknown) {
  return (
    value === "audio/wav" || value === "audio/x-wav" || value === "audio/wave"
  );
}

function decodeReferenceAudio(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

function isWav(audio: Buffer) {
  return (
    audio.length > 12 &&
    audio.subarray(0, 4).toString("ascii") === "RIFF" &&
    audio.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

function referenceAudioDir() {
  return (
    process.env.VOICE_PROFILE_REFERENCE_DIR ||
    process.env.TTS_VOICE_REFERENCE_DIR ||
    ".data/voice-references"
  );
}
