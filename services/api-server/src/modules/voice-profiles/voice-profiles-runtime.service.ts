import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { VoiceProfileRecord } from "./voice-profile-record.js";
import { syncVoiceReferenceAudio } from "./voice-reference-sync.js";
import { analyzeWavReference } from "./wav-reference-quality.js";
import * as legacy from "./voice-profiles.service.js";

const maxReferenceAudioBytes = 10 * 1024 * 1024;

export async function getMyVoiceProfile(userId: string) {
  return toDto(await findActive(userId));
}

export async function getReadyVoiceProfileTtsConfig(userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.getReadyVoiceProfileTtsConfig(userId);
  const profile = await findActive(userId);
  if (!profile || profile.status !== "ready" || !profile.referenceAudioId) return undefined;
  const transcript = cleanTranscript(profile.referenceTranscript);
  return {
    mode: transcript ? "ultimate_clone" as const : profile.voiceMode,
    voiceProfileId: profile.id,
    referenceAudioId: profile.referenceAudioId,
    ...(transcript ? { referenceTranscript: transcript } : {}),
    quality: "hifi" as const,
  };
}

export async function createMyVoiceProfile(
  userId: string,
  body: Record<string, unknown>,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.createMyVoiceProfile(userId, body);
  if (body.consentAccepted !== true) {
    return { ok: false as const, code: "voice_consent_required" };
  }
  const consentVersion = cleanText(body.consentVersion, 100);
  if (!consentVersion) return { ok: false as const, code: "invalid_consent_version" };
  const existing = await findActive(userId);
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const requestHash = repositoryRequestHash({ userId, body });
  const result = await mutateProfile(userId, id, "save", requestHash, (current) => ({
    ...(current ?? newProfile(id, userId, now)),
    displayName: cleanText(body.displayName, 80) || "我的声音",
    consentVersion,
    consentAcceptedAt: isoOrNow(body.consentAcceptedAt, now),
    status: current?.referenceAudioId ? "ready" : "pending_reference_audio",
    updatedAt: now,
  }));
  return result.record
    ? { ok: true as const, profile: toDto(result.record)! }
    : { ok: false as const, code: "voice_profile_conflict" };
}

export async function deleteMyVoiceProfile(userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.deleteMyVoiceProfile(userId);
  const profile = await findActive(userId);
  if (!profile) return { ok: false as const, code: "voice_profile_not_found" };
  const now = new Date().toISOString();
  const requestHash = repositoryRequestHash({ userId, profileId: profile.id });
  const result = await mutateProfile(userId, profile.id, "delete", requestHash,
    (current) => current ? {
      ...current, status: "deleted", deletedAt: now, updatedAt: now,
    } : null);
  return result.record
    ? { ok: true as const, profile: toDto(result.record)! }
    : { ok: false as const, code: "voice_profile_not_found" };
}

export async function attachVoiceProfileReferenceAudio(
  userId: string,
  body: Record<string, unknown>,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.attachVoiceProfileReferenceAudio(userId, body);
  }
  const profile = await findActive(userId);
  if (!profile) return { ok: false as const, code: "voice_profile_not_found" };
  if (!isSupportedWavMime(body.mimeType)) {
    return { ok: false as const, code: "unsupported_reference_audio_type" };
  }
  const claimedDurationMs = numericDurationMs(body.durationMs);
  const audio = decodeAudio(body.audioBase64);
  if (!audio) return { ok: false as const, code: "invalid_reference_audio" };
  if (audio.byteLength > maxReferenceAudioBytes) {
    return { ok: false as const, code: "reference_audio_too_large" };
  }
  if (!isWav(audio)) return { ok: false as const, code: "invalid_reference_audio_format" };
  const quality = analyzeWavReference(audio);
  if (!quality) return { ok: false as const, code: "invalid_reference_audio_format" };
  const tolerance = Math.max(750, quality.durationMs * 0.2);
  if (Math.abs(claimedDurationMs - quality.durationMs) > tolerance) {
    return { ok: false as const, code: "reference_audio_duration_mismatch", quality };
  }
  if (!quality.accepted) return { ok: false as const, code: quality.issues[0], quality };
  mkdirSync(referenceAudioDir(), { recursive: true });
  writeFileSync(join(referenceAudioDir(), `${profile.id}.wav`), audio);
  const syncResult = await syncVoiceReferenceAudio(profile.id, audio);
  if (!syncResult.ok) return {
    ok: false as const,
    code: "voice_reference_sync_failed",
    message: syncResult.message,
  };
  const transcript = cleanTranscript(body.referenceTranscript);
  const requestHash = repositoryRequestHash({
    userId,
    profileId: profile.id,
    quality,
    transcript,
  });
  const result = await mutateProfile(userId, profile.id, "reference", requestHash,
    (current) => current && current.status !== "deleted" ? {
      ...current,
      referenceAudioId: profile.id,
      referenceQuality: quality,
      ...(transcript ? { referenceTranscript: transcript } : {}),
      status: "ready",
      updatedAt: new Date().toISOString(),
    } : null);
  return result.record
    ? { ok: true as const, profile: toDto(result.record)! }
    : { ok: false as const, code: "voice_profile_conflict" };
}

async function findActive(userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    const dto = legacy.getMyVoiceProfile(userId);
    return dto as VoiceProfileRecord | null;
  }
  const profiles = await runtime.postgres.productRecords.query<VoiceProfileRecord>({
    namespace: "voiceProfiles", ownerId: userId, excludedStatus: "deleted", limit: 1,
  });
  return profiles[0] ?? null;
}

async function mutateProfile(
  userId: string,
  profileId: string,
  operation: string,
  requestHash: string,
  mutate: (current: VoiceProfileRecord | null) => VoiceProfileRecord | null,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL voice profile required");
  return withPostgresRepositoryFence(
    { aggregateType: "voice_profile", aggregateId: userId },
    (fence) => runtime.postgres.productRecords.mutate<VoiceProfileRecord>({
      namespace: "voiceProfiles",
      recordKey: profileId,
      commandId: repositoryCommandId({ aggregateId: userId,
        operation: `voice-profile-${operation}`, version: 1, requestHash }),
      commandType: `voice_profile.${operation}`,
      requestHash,
      eventType: `voice_profile.${operation}`,
      fence,
      mutate,
    }),
  );
}

function newProfile(id: string, userId: string, now: string): VoiceProfileRecord {
  return { id, userId, displayName: "我的声音", status: "pending_reference_audio",
    voiceMode: "personal_clone", consentVersion: "", consentAcceptedAt: now,
    createdAt: now, updatedAt: now };
}

function toDto(profile: VoiceProfileRecord | null) {
  if (!profile) return null;
  const transcript = cleanTranscript(profile.referenceTranscript);
  return {
    id: profile.id, displayName: profile.displayName, status: profile.status,
    voiceMode: transcript ? "ultimate_clone" : profile.voiceMode,
    consentVersion: profile.consentVersion,
    consentAcceptedAt: profile.consentAcceptedAt,
    createdAt: profile.createdAt, updatedAt: profile.updatedAt,
    ...(profile.referenceAudioId ? { referenceAudioId: profile.referenceAudioId } : {}),
    ...(transcript ? { referenceTranscript: transcript } : {}),
    ...(profile.referenceQuality ? { referenceQuality: profile.referenceQuality } : {}),
    ...(profile.deletedAt ? { deletedAt: profile.deletedAt } : {}),
  };
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
function cleanTranscript(value: unknown) {
  return cleanText(value, 500).replace(/^请用自然语速朗读[:：]\s*/u, "")
    .replace(/^Read naturally:\s*/iu, "").trim();
}
function isoOrNow(value: unknown, fallback: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : fallback;
}
function numericDurationMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function isSupportedWavMime(value: unknown) {
  return value === "audio/wav" || value === "audio/x-wav" || value === "audio/wave";
}
function decodeAudio(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return Buffer.from(value, "base64"); } catch { return null; }
}
function isWav(audio: Buffer) {
  return audio.length > 12 && audio.subarray(0, 4).toString("ascii") === "RIFF" &&
    audio.subarray(8, 12).toString("ascii") === "WAVE";
}
function referenceAudioDir() {
  return process.env.VOICE_PROFILE_REFERENCE_DIR ||
    process.env.TTS_VOICE_REFERENCE_DIR || ".data/voice-references";
}
