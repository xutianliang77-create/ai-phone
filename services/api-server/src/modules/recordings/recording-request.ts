import type { RecordingJobDto } from "@translation/contracts";

export interface StartRecordingRequest {
  idempotencyKey: string;
  policyVersion: string;
  retentionDays: number;
  recordingType: RecordingJobDto["recordingType"];
  participantIdentity?: string;
  trackId?: string;
}

export function parseRecordingConsentRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  return typeof value.consent === "boolean" && policyVersion(value.policyVersion)
    ? { consent: value.consent, policyVersion: value.policyVersion }
    : null;
}

export function parseStartRecordingRequest(body: unknown): StartRecordingRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const retentionDays = Number(value.retentionDays);
  const recordingType = value.recordingType ?? "room_audio";
  if (!boundedString(value.idempotencyKey, 128) || !policyVersion(value.policyVersion) ||
    !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365 ||
    !isRecordingType(recordingType)) return null;

  const participantIdentity = optionalBoundedString(value.participantIdentity, 256);
  const trackId = optionalTrackId(value.trackId);
  if (participantIdentity === null || trackId === null) return null;
  if (recordingType === "room_audio" && (participantIdentity || trackId)) return null;
  if (recordingType === "participant" && (!participantIdentity || trackId)) return null;
  if (recordingType === "track" && (!participantIdentity || !trackId)) return null;

  return {
    idempotencyKey: value.idempotencyKey,
    policyVersion: value.policyVersion,
    retentionDays,
    recordingType,
    ...(participantIdentity ? { participantIdentity } : {}),
    ...(trackId ? { trackId } : {}),
  };
}

function policyVersion(value: unknown): value is string {
  return boundedString(value, 80) && /^[A-Za-z0-9._-]+$/.test(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function optionalBoundedString(value: unknown, maximum: number) {
  if (value === undefined) return undefined;
  return boundedString(value, maximum) ? value : null;
}

function optionalTrackId(value: unknown) {
  if (value === undefined) return undefined;
  return boundedString(value, 128) && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function isRecordingType(value: unknown): value is RecordingJobDto["recordingType"] {
  return value === "room_audio" || value === "participant" || value === "track";
}
