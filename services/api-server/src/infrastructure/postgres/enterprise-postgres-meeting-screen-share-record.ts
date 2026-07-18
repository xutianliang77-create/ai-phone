import type {
  EnterpriseMeetingScreenShareRecord,
} from "../../modules/enterprise/enterprise-meeting-screen-share.js";

export interface EnterpriseMeetingScreenShareRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  meeting_id: string;
  participant_id: string;
  communication_session_id: string;
  route_epoch: string | number;
  source_type: "screen" | "window" | "tab";
  includes_system_audio: boolean;
  quality_mode: "auto" | "smooth" | "high";
  status: "active" | "paused" | "ended" | "expired";
  generation: string | number;
  track_sid: string | null;
  lease_expires_at: string | Date | null;
  started_at: string | Date;
  paused_at: string | Date | null;
  ended_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  version: string | number;
  idempotency_key: string;
  request_hash: string;
}

export interface EnterpriseMeetingScreenShareCommandRow
  extends Record<string, unknown> {
  command: "acquire" | "pause" | "resume" | "renew" | "stop";
  share_id: string;
  request_hash: string;
  result_status: EnterpriseMeetingScreenShareRecord["status"];
  result_version: string | number;
  result_generation: string | number;
  revoked_generation: string | number | null;
}

export function mapEnterpriseMeetingScreenShareRow(
  row: EnterpriseMeetingScreenShareRow,
  expectedTenantId: string,
): EnterpriseMeetingScreenShareRecord {
  if (row.tenant_id !== expectedTenantId) {
    throw new Error("Enterprise meeting screen share tenant mismatch");
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    meetingId: row.meeting_id,
    participantId: row.participant_id,
    communicationSessionId: row.communication_session_id,
    routeEpoch: positive(row.route_epoch, "route epoch"),
    sourceType: row.source_type,
    includesSystemAudio: row.includes_system_audio,
    qualityMode: row.quality_mode,
    status: row.status,
    generation: positive(row.generation, "generation"),
    ...(row.track_sid ? { trackSid: row.track_sid } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: timestamp(row.lease_expires_at) } : {}),
    startedAt: timestamp(row.started_at),
    ...(row.paused_at ? { pausedAt: timestamp(row.paused_at) } : {}),
    ...(row.ended_at ? { endedAt: timestamp(row.ended_at) } : {}),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    version: positive(row.version, "version"),
  };
}

function positive(value: string | number, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`Invalid enterprise screen share ${field}`);
  }
  return result;
}
function timestamp(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid enterprise screen share timestamp");
  }
  return date.toISOString();
}
