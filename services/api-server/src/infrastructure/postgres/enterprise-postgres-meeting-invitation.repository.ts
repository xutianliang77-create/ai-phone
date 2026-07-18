import type { EnterpriseMeetingParticipantRecord } from
  "../../modules/enterprise/enterprise-meeting.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export interface InviteEnterpriseMeetingGuestInput {
  id: string;
  meetingId: string;
  externalIdentity: string;
  displayName: string;
  language?: string;
  idempotencyKey: string;
  requestHash: string;
}

export class EnterpriseMeetingInvitationPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async invite(input: InviteEnterpriseMeetingGuestInput) {
    const value = normalize(input);
    const inserted = await this.session.query<ParticipantRow>(`
      INSERT INTO enterprise.meeting_participants(
        tenant_id, id, meeting_id, external_identity, role,
        language, display_name, version, invitation_key,
        invitation_request_hash
      ) VALUES ($1, $2, $3, $4, 'guest', $5, $6, 1, $7, $8)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      value.id, value.meetingId, value.externalIdentity,
      value.language ?? null, value.displayName,
      value.idempotencyKey, value.requestHash,
    ]);
    if (inserted.rows[0]) {
      return { status: "created" as const,
        participant: mapParticipant(inserted.rows[0], this.session.context.tenantId) };
    }
    const existing = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2 AND invitation_key = $3
    `, [value.meetingId, value.idempotencyKey]);
    const row = existing.rows[0];
    if (!row || row.invitation_request_hash !== value.requestHash) {
      return { status: "conflict" as const };
    }
    return { status: "replayed" as const,
      participant: mapParticipant(row, this.session.context.tenantId) };
  }
}

function normalize(input: InviteEnterpriseMeetingGuestInput) {
  const id = uuid(input.id);
  const meetingId = uuid(input.meetingId);
  const externalIdentity = bounded(input.externalIdentity, 200);
  const displayName = bounded(input.displayName, 120);
  const language = input.language === undefined
    ? undefined : code(input.language, 35);
  const idempotencyKey = code(input.idempotencyKey, 160);
  if (externalIdentity !== `guest:${id}` || !/^[a-f0-9]{64}$/.test(input.requestHash)) {
    throw new Error("Invalid enterprise meeting invitation");
  }
  return { id, meetingId, externalIdentity, displayName, language,
    idempotencyKey, requestHash: input.requestHash };
}

function mapParticipant(
  row: ParticipantRow,
  tenantId: string,
): EnterpriseMeetingParticipantRecord {
  if (row.tenant_id !== tenantId || row.role !== "guest" || row.user_id !== null) {
    throw new Error("Invalid enterprise meeting invitation row");
  }
  return {
    id: row.id, tenantId, meetingId: row.meeting_id,
    externalIdentity: row.external_identity, role: "guest",
    language: row.language ?? undefined, displayName: row.display_name,
    joinedAt: optionalTime(row.joined_at), leftAt: optionalTime(row.left_at),
    version: Number(row.version),
  };
}

function uuid(value: unknown) {
  const result = bounded(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(result)) throw new Error("Invalid enterprise meeting invitation ID");
  return result;
}
function bounded(value: unknown, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || Buffer.byteLength(result) > max) {
    throw new Error("Invalid enterprise meeting invitation value");
  }
  return result;
}
function code(value: unknown, max: number) {
  const result = bounded(value, max);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    throw new Error("Invalid enterprise meeting invitation code");
  }
  return result;
}
function optionalTime(value: string | Date | null) {
  return value ? new Date(value).toISOString() : undefined;
}

interface ParticipantRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; user_id: string | null;
  external_identity: string; role: "guest"; language: string | null;
  display_name: string; joined_at: string | Date | null;
  left_at: string | Date | null; version: string | number;
  invitation_request_hash: string;
}
