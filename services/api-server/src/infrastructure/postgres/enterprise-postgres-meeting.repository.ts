import {
  canTransitionEnterpriseMeeting,
  isEnterpriseMeetingArtifactStatus,
  isEnterpriseMeetingArtifactType,
  isEnterpriseMeetingParticipantRole,
  isEnterpriseMeetingStatus,
  type AddEnterpriseMeetingArtifactInput,
  type AddEnterpriseMeetingParticipantInput,
  type CreateEnterpriseMeetingInput,
  type EnterpriseMeetingArtifactRecord,
  type EnterpriseMeetingArtifactStatus,
  type EnterpriseMeetingArtifactType,
  type EnterpriseMeetingParticipantRecord,
  type EnterpriseMeetingParticipantRole,
  type EnterpriseMeetingRecord,
  type EnterpriseMeetingStatus,
} from "../../modules/enterprise/enterprise-meeting.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMeetingPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}
  async create(input: CreateEnterpriseMeetingInput) {
    const value = normalizeMeeting(input);
    const result = await this.session.query<MeetingRow>(`
      INSERT INTO enterprise.meetings(
        tenant_id, id, title, host_user_id, scheduled_at, status,
        policy, retention_until, created_at, updated_at, version,
        creation_key, creation_request_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $9, 1, $10, $11)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      value.id, value.title,
      enterprisePostgresAccountSubjectId(value.hostUserId),
      value.scheduledAt ?? null, value.status, JSON.stringify(value.policy),
      value.retentionUntil ?? null, value.createdAt,
      value.idempotencyKey, value.requestHash,
    ]);
    if (result.rows[0]) {
      return { status: "created" as const, meeting: mapMeeting(result.rows[0]) };
    }
    const existing = await this.findByCreationKey(value.idempotencyKey);
    if (!existing || existing.requestHash !== value.requestHash) {
      return { status: "idempotency_conflict" as const };
    }
    return { status: "replayed" as const, meeting: existing.meeting };
  }
  async findByCreationKey(idempotencyKey: string) {
    const result = await this.session.query<MeetingRow>(`
      SELECT * FROM enterprise.meetings
      WHERE tenant_id = $1 AND creation_key = $2
    `, [eventKey(idempotencyKey)]);
    const row = result.rows[0];
    return row ? { meeting: mapMeeting(row), requestHash: row.creation_request_hash } : null;
  }
  async find(meetingId: string, lock = false) {
    const result = await this.session.query<MeetingRow>(`
      SELECT * FROM enterprise.meetings
      WHERE tenant_id = $1 AND id = $2
      ${lock ? "FOR UPDATE" : ""}
    `, [requiredUuid(meetingId)]);
    return result.rows[0] ? mapMeeting(result.rows[0]) : null;
  }
  async list(recoverableOnly = false) {
    const result = await this.session.query<MeetingRow>(`
      SELECT * FROM enterprise.meetings
      WHERE tenant_id = $1
        ${recoverableOnly
          ? "AND status IN ('provisioning', 'active', 'ending')"
          : ""}
      ORDER BY COALESCE(scheduled_at, created_at) DESC, id
      LIMIT 200
    `);
    return result.rows.map(mapMeeting);
  }
  async transition(input: {
    meetingId: string;
    status: EnterpriseMeetingStatus;
    expectedVersion: number;
    occurredAt: string;
  }) {
    if (!isEnterpriseMeetingStatus(input.status) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Invalid enterprise meeting transition");
    }
    const occurredAt = requiredIso(input.occurredAt);
    const current = await this.find(input.meetingId, true);
    if (!current) return { status: "not_found" as const };
    if (current.version !== input.expectedVersion) return { status: "conflict" as const };
    if (!canTransitionEnterpriseMeeting(current.status, input.status) ||
      occurredAt < current.updatedAt ||
      (current.startedAt !== undefined && occurredAt < current.startedAt)) {
      return { status: "invalid_transition" as const };
    }
    const startedAt = input.status === "active" ? occurredAt : current.startedAt ?? null;
    const endedAt = ["ended", "cancelled", "failed"].includes(input.status)
      ? occurredAt : null;
    const result = await this.session.query<MeetingRow>(`
      UPDATE enterprise.meetings
      SET status = $3, started_at = $4, ended_at = $5,
        updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $7 AND status = $8
      RETURNING *
    `, [
      requiredUuid(input.meetingId), input.status, startedAt, endedAt,
      occurredAt, input.expectedVersion, current.status,
    ]);
    return result.rows[0]
      ? { status: "updated" as const, meeting: mapMeeting(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async addParticipant(input: AddEnterpriseMeetingParticipantInput) {
    const value = normalizeParticipant(input);
    const meeting = await this.find(value.meetingId, true);
    if (!meeting) return { status: "not_found" as const };
    if (value.role === "host" && value.userId !== meeting.hostUserId) {
      return { status: "conflict" as const };
    }
    const result = await this.session.query<ParticipantRow>(`
      INSERT INTO enterprise.meeting_participants(
        tenant_id, id, meeting_id, user_id, external_identity,
        role, language, caption_language, translated_audio_enabled,
        playback_generation, display_name, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 1, $9, 1)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      value.id, value.meetingId,
      value.userId ? enterprisePostgresAccountSubjectId(value.userId) : null,
      value.externalIdentity ?? null, value.role, value.language ?? null,
      value.captionLanguage, value.displayName,
    ]);
    return result.rows[0]
      ? { status: "created" as const, participant: mapParticipant(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async addArtifact(input: AddEnterpriseMeetingArtifactInput) {
    const value = normalizeArtifact(input);
    const meeting = await this.find(value.meetingId, true);
    if (!meeting) return { status: "not_found" as const };
    const result = await this.session.query<ArtifactRow>(`
      INSERT INTO enterprise.meeting_artifacts(
        tenant_id, id, meeting_id, artifact_type, object_id,
        provider_fingerprint, status, created_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      value.id, value.meetingId, value.artifactType, value.objectId,
      value.providerFingerprint ?? null, value.status, value.createdAt,
    ]);
    return result.rows[0]
      ? { status: "created" as const, artifact: mapArtifact(result.rows[0]) }
      : { status: "conflict" as const };
  }
  async participants(meetingId: string) {
    const result = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2
      ORDER BY COALESCE(joined_at, 'infinity'::timestamptz), id
    `, [requiredUuid(meetingId)]);
    return result.rows.map(mapParticipant);
  }
  async participantById(meetingId: string, participantId: string) {
    const result = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
    `, [requiredUuid(meetingId), requiredUuid(participantId)]);
    return result.rows[0] ? mapParticipant(result.rows[0]) : null;
  }
  async participantByUser(meetingId: string, userId: string) {
    const result = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2 AND user_id = $3
    `, [requiredUuid(meetingId), enterprisePostgresAccountSubjectId(userId)]);
    return result.rows[0] ? mapParticipant(result.rows[0]) : null;
  }
  async artifacts(meetingId: string) {
    const result = await this.session.query<ArtifactRow>(`
      SELECT * FROM enterprise.meeting_artifacts
      WHERE tenant_id = $1 AND meeting_id = $2
      ORDER BY created_at, id
    `, [requiredUuid(meetingId)]);
    return result.rows.map(mapArtifact);
  }
}

function normalizeMeeting(input: CreateEnterpriseMeetingInput) {
  const createdAt = requiredIso(input.createdAt);
  const scheduledAt = optionalIso(input.scheduledAt);
  const retentionUntil = optionalIso(input.retentionUntil);
  if (!["scheduled", "provisioning"].includes(input.status) ||
    !validPolicy(input.policy) ||
    (scheduledAt && scheduledAt < createdAt) ||
    (retentionUntil && retentionUntil <= createdAt)) {
    throw new Error("Invalid enterprise meeting");
  }
  return {
    ...input, id: requiredUuid(input.id), title: bounded(input.title, 200),
    hostUserId: enterprisePostgresAccountSubjectId(input.hostUserId),
    createdAt, scheduledAt, retentionUntil,
    idempotencyKey: eventKey(input.idempotencyKey),
    requestHash: hash(input.requestHash),
  };
}

function normalizeParticipant(input: AddEnterpriseMeetingParticipantInput) {
  const userId = input.userId
    ? enterprisePostgresAccountSubjectId(input.userId) : undefined;
  const externalIdentity = input.externalIdentity
    ? code(input.externalIdentity, 200) : undefined;
  if (!isEnterpriseMeetingParticipantRole(input.role) ||
    Boolean(userId) === Boolean(externalIdentity) ||
    (input.role === "guest" ? !externalIdentity : !userId)) {
    throw new Error("Invalid enterprise meeting participant");
  }
  return {
    ...input, id: requiredUuid(input.id), meetingId: requiredUuid(input.meetingId),
    userId, externalIdentity, language: input.language ? code(input.language, 35) : undefined,
    captionLanguage: captionLanguage(input.language),
    displayName: bounded(input.displayName, 120),
  };
}

function normalizeArtifact(input: AddEnterpriseMeetingArtifactInput) {
  if (!isEnterpriseMeetingArtifactType(input.artifactType) ||
    !isEnterpriseMeetingArtifactStatus(input.status) ||
    String(input.status) === "published") {
    throw new Error("Invalid enterprise meeting artifact");
  }
  return {
    ...input, id: requiredUuid(input.id), meetingId: requiredUuid(input.meetingId),
    objectId: requiredUuid(input.objectId), createdAt: requiredIso(input.createdAt),
    providerFingerprint: input.providerFingerprint
      ? code(input.providerFingerprint, 200) : undefined,
  };
}

function requiredUuid(value: unknown) {
  const text = bounded(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(text)) throw new Error("Invalid enterprise meeting ID");
  return text;
}
function bounded(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || Buffer.byteLength(text) > max) throw new Error("Invalid meeting text");
  return text;
}
function code(value: unknown, max: number) {
  const text = bounded(value, max);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) throw new Error("Invalid meeting code");
  return text;
}
function eventKey(value: unknown) {
  const text = bounded(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) {
    throw new Error("Invalid meeting idempotency key");
  }
  return text;
}
function hash(value: unknown) {
  const text = bounded(value, 64);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error("Invalid meeting request hash");
  return text;
}
function validPolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  const keys = Object.keys(policy);
  return keys.every((key) => [
    "allowGuests", "screenShareRole", "defaultLanguage",
  ].includes(key)) && typeof policy.allowGuests === "boolean" &&
    ["host_only", "members"].includes(String(policy.screenShareRole)) &&
    (policy.defaultLanguage === undefined ||
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(String(policy.defaultLanguage)));
}
function requiredIso(value: unknown) {
  const text = bounded(value, 64); const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error("Invalid meeting timestamp");
  }
  return text;
}
function optionalIso(value: unknown) { return value == null ? undefined : requiredIso(value); }
function iso(value: string | Date) { return new Date(value).toISOString(); }
function optionalDate(value: string | Date | null) { return value ? iso(value) : undefined; }
function captionLanguage(value: string | undefined) {
  return value?.toLowerCase().startsWith("en") ? "en" as const : "zh" as const;
}

function mapMeeting(row: MeetingRow): EnterpriseMeetingRecord {
  return {
    id: row.id, tenantId: row.tenant_id, title: row.title,
    hostUserId: row.host_user_id, status: row.status, policy: row.policy,
    scheduledAt: optionalDate(row.scheduled_at),
    retentionUntil: optionalDate(row.retention_until), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), startedAt: optionalDate(row.started_at),
    endedAt: optionalDate(row.ended_at), version: Number(row.version),
  };
}
function mapParticipant(row: ParticipantRow): EnterpriseMeetingParticipantRecord {
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    userId: row.user_id ?? undefined, externalIdentity: row.external_identity ?? undefined,
    role: row.role, language: row.language ?? undefined, displayName: row.display_name,
    captionLanguage: row.caption_language,
    translatedAudioEnabled: row.translated_audio_enabled,
    playbackGeneration: Number(row.playback_generation),
    joinedAt: optionalDate(row.joined_at), leftAt: optionalDate(row.left_at),
    version: Number(row.version),
  };
}
function mapArtifact(row: ArtifactRow): EnterpriseMeetingArtifactRecord {
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    artifactType: row.artifact_type, objectId: row.object_id,
    providerFingerprint: row.provider_fingerprint ?? undefined, status: row.status,
    createdAt: iso(row.created_at), publishedAt: optionalDate(row.published_at),
    version: Number(row.version),
  };
}

interface MeetingRow extends Record<string, unknown> {
  id: string; tenant_id: string; title: string; host_user_id: string;
  scheduled_at: string | Date | null; status: EnterpriseMeetingStatus;
  policy: EnterpriseMeetingRecord["policy"]; retention_until: string | Date | null;
  created_at: string | Date; updated_at: string | Date;
  started_at: string | Date | null; ended_at: string | Date | null;
  version: string | number; creation_request_hash: string;
}
interface ParticipantRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; user_id: string | null;
  external_identity: string | null; role: EnterpriseMeetingParticipantRole;
  language: string | null; display_name: string; joined_at: string | Date | null;
  caption_language: "zh" | "en"; translated_audio_enabled: boolean;
  playback_generation: string | number;
  left_at: string | Date | null; version: string | number;
}
interface ArtifactRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string;
  artifact_type: EnterpriseMeetingArtifactType; object_id: string;
  provider_fingerprint: string | null; status: EnterpriseMeetingArtifactStatus;
  created_at: string | Date; published_at: string | Date | null;
  version: string | number;
}
