import { createHash } from "node:crypto";
import { isSupportedLanguage, type RealtimeSegmentSyncAck, type RealtimeSegmentSyncMetadata,
  type SessionSegmentDto } from "@translation/contracts";

export const RESULT_SYNC_CONSENT_VERSION = "result-text-sync-v2";
export interface ResultSyncGrant {
  scopeId: string; deploymentId: string; ownerId: string; modelPolicyRevision: string;
  consentVersion: string; grantedAt: string; expiresAt: string; revokedAt?: string;
}
export interface ResultSyncState {
  grant: ResultSyncGrant;
  grantHistory?: ResultSyncGrant[];
  receipts: Array<{ opId: string; requestHash: string; ack: RealtimeSegmentSyncAck }>;
  revisions: Record<string, { revision: number; contentHash: string }>;
}
export class ResultSyncError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function syncKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    !["__proto__", "constructor", "prototype"].includes(value) &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(k => keys.includes(k));
}
export function canonicalSyncJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSyncJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k =>
    `${JSON.stringify(k)}:${canonicalSyncJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const resultSyncHash = (value: unknown) => createHash("sha256")
  .update(canonicalSyncJson(value)).digest("hex");

/** Deliberately text-only: server-owned usage/provider/speaker claims are rejected,
 * not silently trusted or discarded. Further metadata needs an explicit contract. */
export function parseResultSync(body: unknown): { sync: RealtimeSegmentSyncMetadata; segments: SessionSegmentDto[] } {
  const invalid = () => { throw new ResultSyncError("invalid_result_sync", 400); };
  if (!record(body) || !only(body, ["operation", "sync", "segments"]) ||
      body.operation !== "sync" || !record(body.sync) || !Array.isArray(body.segments)) return invalid();
  const sync = body.sync;
  if (!only(sync, ["contractVersion", "deploymentId", "opId", "modelPolicyRevision", "scopeId", "revisions"]) ||
      sync.contractVersion !== 1 || ![sync.deploymentId, sync.opId, sync.modelPolicyRevision, sync.scopeId].every(syncKey) ||
      !Array.isArray(sync.revisions) || body.segments.length < 1 || body.segments.length > 100 ||
      sync.revisions.length !== body.segments.length || Buffer.byteLength(JSON.stringify(body)) > 256 * 1024) return invalid();
  const ids = new Set<string>();
  for (const [index, segment] of body.segments.entries()) {
    if (!record(segment) || !only(segment, ["id", "revision", "sourceText", "translatedText", "rawText",
      "optimizedText", "sourceLanguage", "targetLanguage"]) || !syncKey(segment.id) || ids.has(segment.id) ||
      !Number.isSafeInteger(segment.revision) || Number(segment.revision) < 1 ||
      typeof segment.sourceLanguage !== "string" || typeof segment.targetLanguage !== "string" ||
      !isSupportedLanguage(segment.sourceLanguage) || !isSupportedLanguage(segment.targetLanguage) ||
      segment.sourceLanguage === segment.targetLanguage) return invalid();
    ids.add(segment.id);
    for (const key of ["sourceText", "translatedText", "rawText", "optimizedText"]) {
      const text = segment[key];
      if ((key === "sourceText" || key === "translatedText" || text !== undefined) &&
          (typeof text !== "string" || text.length > 16000)) return invalid();
    }
    if (!(segment.sourceText as string).trim()) return invalid();
    const revision = sync.revisions[index];
    if (!record(revision) || !only(revision, ["segmentId", "revision", "contentHash"]) ||
        revision.segmentId !== segment.id || revision.revision !== segment.revision ||
        revision.contentHash !== resultSyncHash(segment)) return invalid();
  }
  return structuredClone(body) as unknown as ReturnType<typeof parseResultSync>;
}

export function syncTextProjection(segment: SessionSegmentDto) {
  return Object.fromEntries(["id", "revision", "sourceText", "translatedText", "rawText",
    "optimizedText", "sourceLanguage", "targetLanguage"].filter(k =>
      segment[k as keyof SessionSegmentDto] !== undefined).map(k => [k, segment[k as keyof SessionSegmentDto]]));
}
