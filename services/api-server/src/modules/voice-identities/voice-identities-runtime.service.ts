import { randomUUID } from "node:crypto";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { analyzeWavReference } from "../voice-profiles/wav-reference-quality.js";
import {
  deleteVoiceIdentityEmbedding,
  enrollVoiceIdentity,
  matchVoiceIdentity,
} from "./voice-identity-provider.js";
import type { VoiceIdentityRecord } from "./voice-identity-record.js";
import * as legacy from "./voice-identities.service.js";

export async function listVoiceIdentities(userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.listVoiceIdentities(userId);
  const records = await listRecords(userId);
  return records.filter((record) => record.status !== "deleted").map(toDto);
}

export async function createVoiceIdentity(
  userId: string,
  body: Record<string, unknown>,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.createVoiceIdentity(userId, body);
  const displayName = text(body.displayName, 80);
  const consentVersion = text(body.consentVersion, 100);
  if (!displayName || body.consentAccepted !== true || !consentVersion) return null;
  const now = new Date().toISOString();
  const record: VoiceIdentityRecord = {
    id: randomUUID(), userId, displayName, status: "pending_enrollment",
    consentVersion, consentAcceptedAt: now,
    matchThreshold: threshold(body.matchThreshold),
    createdAt: now, updatedAt: now,
  };
  const result = await mutateIdentity(userId, record.id, "create", record,
    (current) => current ?? record);
  return result.record ? toDto(result.record) : null;
}

export async function enrollIdentity(
  userId: string,
  identityId: string,
  body: Record<string, unknown>,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.enrollIdentity(userId, identityId, body);
  const record = await find(userId, identityId);
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
    const result = await mutateIdentity(userId, identityId, "enroll",
      { embeddingRef }, (current) => current &&
        current.status !== "revoked" && current.status !== "deleted" ? {
          ...current, embeddingRef, status: "ready",
          updatedAt: new Date().toISOString(),
        } : null);
    if (!result.record || result.record.status !== "ready") {
      await deleteVoiceIdentityEmbedding(embeddingRef).catch(() => undefined);
      return failure("voice_identity_revoked", 409);
    }
    return { ok: true as const, identity: toDto(result.record), quality };
  } catch (error) {
    return failure("voice_identity_provider_unavailable", 503, error);
  }
}

export async function revokeIdentity(userId: string, identityId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.revokeIdentity(userId, identityId);
  const record = await find(userId, identityId);
  if (!record || record.status === "deleted") return failure("voice_identity_not_found", 404);
  const now = new Date().toISOString();
  const result = await mutateIdentity(userId, identityId, "revoke", {},
    (current) => current ? {
      ...current, status: "revoked", revokedAt: now, updatedAt: now,
    } : null);
  if (!result.record) return failure("voice_identity_not_found", 404);
  if (result.record.embeddingRef) {
    try {
      await removeStoredEmbedding(userId, result.record);
    } catch (error) {
      return failure("voice_identity_provider_unavailable", 503, error);
    }
  }
  return { ok: true as const, identity: toDto(await find(userId, identityId) ?? result.record) };
}

export async function deleteIdentity(userId: string, identityId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.deleteIdentity(userId, identityId);
  const revoked = await revokeIdentity(userId, identityId);
  if (!revoked.ok) return revoked;
  const now = new Date().toISOString();
  const result = await mutateIdentity(userId, identityId, "delete", {},
    (current) => current ? {
      ...current, status: "deleted", deletedAt: now, updatedAt: now,
    } : null);
  return result.record
    ? { ok: true as const, identity: toDto(result.record) }
    : failure("voice_identity_not_found", 404);
}

export async function matchAuthorizedIdentity(userId: string, audioBase64: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.matchAuthorizedIdentity(userId, audioBase64);
  const candidates = (await listRecords(userId))
    .filter((record) => record.status === "ready" && record.embeddingRef);
  if (!candidates.length) return { identity: null, confidence: 0 };
  const result = await matchVoiceIdentity({
    audioBase64,
    candidateRefs: candidates.map((record) => record.embeddingRef!),
    threshold: Math.min(...candidates.map((record) => record.matchThreshold)),
  });
  const matched = candidates.find((record) => record.embeddingRef === result.embeddingRef);
  return {
    identity: matched && result.confidence >= matched.matchThreshold ? toDto(matched) : null,
    confidence: result.confidence,
  };
}

export async function listPendingVoiceIdentityDeletions() {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return [];
  const records = await runtime.postgres.productRecords.query<VoiceIdentityRecord>({
    namespace: "voiceIdentities", excludedStatus: "ready", limit: 500,
  });
  return records.filter((record) => Boolean(record.embeddingRef));
}

export async function removeStoredEmbedding(
  userId: string,
  record: VoiceIdentityRecord,
) {
  if (!record.embeddingRef) return false;
  const embeddingRef = record.embeddingRef;
  await deleteVoiceIdentityEmbedding(embeddingRef);
  const result = await mutateIdentity(userId, record.id, "embedding-delete",
    { embeddingRef }, (current) => {
      if (!current || current.status === "ready" || current.embeddingRef !== embeddingRef) {
        return null;
      }
      const next = { ...current, updatedAt: new Date().toISOString() };
      delete next.embeddingRef;
      return next;
    });
  return Boolean(result.record && !result.record.embeddingRef);
}

async function listRecords(userId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return [];
  return runtime.postgres.productRecords.query<VoiceIdentityRecord>({
    namespace: "voiceIdentities", ownerId: userId, limit: 500,
  });
}

async function find(userId: string, identityId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return null;
  const record = await runtime.postgres.productRecords.find<VoiceIdentityRecord>(
    "voiceIdentities", identityId,
  );
  return record?.userId === userId ? record : null;
}

async function mutateIdentity(
  userId: string,
  identityId: string,
  operation: string,
  payload: unknown,
  mutate: (current: VoiceIdentityRecord | null) => VoiceIdentityRecord | null,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL voice identity required");
  const requestHash = repositoryRequestHash({ userId, identityId, operation, payload });
  return withPostgresRepositoryFence(
    { aggregateType: "voice_identity", aggregateId: identityId },
    (fence) => runtime.postgres.productRecords.mutate<VoiceIdentityRecord>({
      namespace: "voiceIdentities", recordKey: identityId,
      commandId: repositoryCommandId({ aggregateId: identityId,
        operation: `voice-identity-${operation}`, version: 1, requestHash }),
      commandType: `voice_identity.${operation}`, requestHash,
      eventType: `voice_identity.${operation}`, fence, mutate,
    }),
  );
}

function toDto({ embeddingRef: _ref, userId: _user, ...record }: VoiceIdentityRecord) {
  return record;
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function audioPayload(value: unknown) {
  return typeof value === "string" && value.trim().length <= 15 * 1024 * 1024
    ? value.trim() : "";
}
function threshold(value: unknown) {
  return typeof value === "number" && value >= 0.5 && value <= 0.99 ? value : 0.72;
}
function decode(value: string) {
  try { return value ? Buffer.from(value, "base64") : null; } catch { return null; }
}
function failure(code: string, statusCode: number, error?: unknown) {
  return { ok: false as const, code, statusCode,
    message: error instanceof Error ? error.message : code };
}
