import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { analyzeWavReference } from "../voice-profiles/wav-reference-quality.js";
import {
  deleteVoiceIdentityEmbedding,
  enrollVoiceIdentity,
  matchVoiceIdentity,
} from "./voice-identity-provider.js";
import type { VoiceIdentityRecord } from "./voice-identity-record.js";

export function listVoiceIdentities(userId: string) {
  return records(userId).filter((record) => record.status !== "deleted").map(toDto);
}

export function createVoiceIdentity(userId: string, body: Record<string, unknown>) {
  const displayName = text(body.displayName, 80);
  const consentVersion = text(body.consentVersion, 100);
  if (!displayName || body.consentAccepted !== true || !consentVersion) return null;
  return runStoreTransaction(() => {
    const now = new Date().toISOString();
    const record: VoiceIdentityRecord = {
      id: randomUUID(), userId, displayName, status: "pending_enrollment",
      consentVersion, consentAcceptedAt: now,
      matchThreshold: threshold(body.matchThreshold),
      createdAt: now, updatedAt: now,
    };
    getStoreSnapshot().voiceIdentities.push(record);
    persistStoreSnapshot();
    return toDto(record);
  });
}

export async function enrollIdentity(
  userId: string,
  identityId: string,
  body: Record<string, unknown>,
) {
  const record = find(userId, identityId);
  if (!record || record.status === "deleted") return failure("voice_identity_not_found", 404);
  if (record.status === "revoked") return failure("voice_identity_revoked", 409);
  const audioBase64 = audioPayload(body.audioBase64);
  if (!audioBase64) return failure("invalid_voice_identity_audio", 400);
  const audio = decode(audioBase64);
  const quality = audio ? analyzeWavReference(audio) : null;
  if (!quality) return failure("invalid_voice_identity_audio", 400);
  if (!quality.accepted) return { ...failure(quality.issues[0], 422), quality };
  try {
    const embeddingRef = await enrollVoiceIdentity({ identityId, audioBase64 });
    let accepted = false;
    runStoreTransaction(() => {
      const current = find(userId, identityId);
      if (!current || current.status === "revoked" || current.status === "deleted") return;
      current.embeddingRef = embeddingRef;
      current.status = "ready";
      current.updatedAt = new Date().toISOString();
      accepted = true;
      persistStoreSnapshot();
    });
    if (!accepted) {
      runStoreTransaction(() => {
        const current = find(userId, identityId);
        if (!current || current.status === "ready") return;
        current.embeddingRef = embeddingRef;
        persistStoreSnapshot();
      });
      await removeStoredEmbedding(userId, identityId, embeddingRef).catch(() => undefined);
      return failure("voice_identity_revoked", 409);
    }
    return { ok: true as const, identity: toDto(find(userId, identityId)!), quality };
  } catch (error) {
    return failure("voice_identity_provider_unavailable", 503, error);
  }
}

export async function revokeIdentity(userId: string, identityId: string) {
  const record = find(userId, identityId);
  if (!record || record.status === "deleted") return failure("voice_identity_not_found", 404);
  const embeddingRef = record.embeddingRef;
  runStoreTransaction(() => {
    record.status = "revoked";
    record.revokedAt = new Date().toISOString();
    record.updatedAt = record.revokedAt;
    persistStoreSnapshot();
  });
  if (embeddingRef) {
    try {
      await removeStoredEmbedding(userId, identityId, embeddingRef);
    } catch (error) {
      return failure("voice_identity_provider_unavailable", 503, error);
    }
  }
  return { ok: true as const, identity: toDto(record) };
}

export async function deleteIdentity(userId: string, identityId: string) {
  const result = await revokeIdentity(userId, identityId);
  if (!result.ok) return result;
  const record = find(userId, identityId)!;
  runStoreTransaction(() => {
    record.status = "deleted";
    record.deletedAt = new Date().toISOString();
    record.updatedAt = record.deletedAt;
    persistStoreSnapshot();
  });
  return { ok: true as const, identity: toDto(record) };
}

export async function matchAuthorizedIdentity(
  userId: string,
  audioBase64: string,
) {
  const candidates = records(userId).filter((item) => item.status === "ready" && item.embeddingRef);
  if (!candidates.length) return { identity: null, confidence: 0 };
  const thresholdValue = Math.min(...candidates.map((item) => item.matchThreshold));
  const result = await matchVoiceIdentity({
    audioBase64,
    candidateRefs: candidates.map((item) => item.embeddingRef!),
    threshold: thresholdValue,
  });
  const matched = candidates.find((item) => item.embeddingRef === result.embeddingRef);
  return {
    identity: matched && result.confidence >= matched.matchThreshold ? toDto(matched) : null,
    confidence: result.confidence,
  };
}

function records(userId: string) {
  return getStoreSnapshot().voiceIdentities.filter((record) => record.userId === userId);
}
function find(userId: string, id: string) { return records(userId).find((item) => item.id === id) ?? null; }
function toDto({ embeddingRef: _ref, userId: _user, ...record }: VoiceIdentityRecord) { return record; }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function audioPayload(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= 15 * 1024 * 1024 ? trimmed : "";
}
function threshold(value: unknown) { return typeof value === "number" && value >= 0.5 && value <= 0.99 ? value : 0.72; }
function decode(value: string) { try { return value ? Buffer.from(value, "base64") : null; } catch { return null; } }
async function removeStoredEmbedding(userId: string, identityId: string, embeddingRef: string) {
  await deleteVoiceIdentityEmbedding(embeddingRef);
  runStoreTransaction(() => {
    const current = find(userId, identityId);
    if (!current || current.embeddingRef !== embeddingRef || current.status === "ready") return;
    delete current.embeddingRef;
    current.updatedAt = new Date().toISOString();
    persistStoreSnapshot();
  });
}
function failure(code: string, statusCode: number, error?: unknown) {
  return { ok: false as const, code, statusCode, message: error instanceof Error ? error.message : code };
}
