import { createHash, randomUUID } from "node:crypto";
import type {
  EnterpriseMeetingCaptionEvent,
  EnterpriseMeetingCaptionLanguage,
} from "@translation/contracts";
import type {
  EnterpriseMeetingParticipantRecord,
  EnterpriseMeetingStatus,
} from "../../modules/enterprise/enterprise-meeting.js";
import {
  enterpriseMeetingParticipantIdentity,
  type EnterpriseMeetingTranslationDelivery,
  type EnterpriseMeetingTranslationPreferenceInput,
  type EnterpriseMeetingWorkerCaptionInput,
} from "../../modules/enterprise/enterprise-meeting-translation.js";
import type { EnterpriseWorkerDispatchGrantRecord } from
  "./enterprise-postgres-worker-dispatch-record.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMeetingTranslationPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async updatePreference(input: EnterpriseMeetingTranslationPreferenceInput) {
    const meetingId = uuid(input.meetingId);
    const participantId = input.participantId ? uuid(input.participantId) : undefined;
    const joinedAt = input.joinedAt ? iso(input.joinedAt) : undefined;
    const current = participantId
      ? await this.participant(meetingId, participantId, true)
      : await this.participantForActor(meetingId);
    if (!current) return { status: "not_found" as const };
    if (!ownsParticipant(this.session, current)) {
      return { status: "forbidden" as const };
    }
    if (input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version) {
      return { status: "conflict" as const };
    }
    const meeting = await this.session.query<{ status: EnterpriseMeetingStatus }>(`
      SELECT status FROM enterprise.meetings
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [meetingId]);
    if (!meeting.rows[0]) return { status: "not_found" as const };
    if (["ended", "cancelled", "failed"].includes(meeting.rows[0].status)) {
      return { status: "not_joinable" as const };
    }
    const changed = current.captionLanguage !== input.captionLanguage ||
      current.translatedAudioEnabled !== input.translatedAudioEnabled;
    if (!changed && (!joinedAt || current.joinedAt)) {
      return { status: "updated" as const, participant: current };
    }
    const result = await this.session.query<ParticipantRow>(`
      UPDATE enterprise.meeting_participants
      SET caption_language = $4, translated_audio_enabled = $5,
        playback_generation = playback_generation + CASE WHEN $6 THEN 1 ELSE 0 END,
        joined_at = COALESCE(joined_at, $7), version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3 AND version = $8
      RETURNING *
    `, [meetingId, current.id, input.captionLanguage,
      input.translatedAudioEnabled, changed, joinedAt ?? null, current.version]);
    return result.rows[0]
      ? { status: "updated" as const, participant: mapParticipant(result.rows[0]) }
      : { status: "conflict" as const };
  }

  async appendTargetEvents(input: {
    meetingId: string;
    communicationSessionId: string;
    grant: EnterpriseWorkerDispatchGrantRecord;
    sourceParticipantId: string;
    sourceTrackSid: string;
    events: EnterpriseMeetingWorkerCaptionInput[];
  }): Promise<EnterpriseMeetingTranslationDelivery[]> {
    const meetingId = uuid(input.meetingId);
    const sourceParticipantId = uuid(input.sourceParticipantId);
    const sourceTrackSid = bounded(input.sourceTrackSid, 128);
    const source = await this.participant(meetingId, sourceParticipantId, false);
    if (!source || source.leftAt || !source.joinedAt) {
      throw new Error("Enterprise meeting source participant is not active");
    }
    const targets = await this.activeParticipants(meetingId);
    const deliveries: EnterpriseMeetingTranslationDelivery[] = [];
    for (const submitted of input.events) {
      const event = normalizeEvent(submitted);
      const captionLanguage = event.type === "transcript.final"
        ? event.sourceLanguage : event.targetLanguage;
      for (const target of targets) {
        if (target.captionLanguage !== captionLanguage) continue;
        deliveries.push(await this.storeDelivery({
          meetingId,
          communicationSessionId: bounded(input.communicationSessionId, 200),
          grant: input.grant,
          sourceParticipantId,
          sourceDisplayName: source.displayName,
          sourceTrackSid,
          target,
          event,
        }));
      }
    }
    return deliveries;
  }

  private async storeDelivery(input: {
    meetingId: string;
    communicationSessionId: string;
    grant: EnterpriseWorkerDispatchGrantRecord;
    sourceParticipantId: string;
    sourceDisplayName: string;
    sourceTrackSid: string;
    target: EnterpriseMeetingParticipantRecord;
    event: EnterpriseMeetingWorkerCaptionInput;
  }) {
    const audioEnabled = input.event.type === "translation.final" &&
      input.target.translatedAudioEnabled;
    const audioStatus = audioEnabled ? "not_ready" as const : "disabled" as const;
    const eventKey = digest({
      grantId: input.grant.id,
      generation: input.grant.generation,
      sourceParticipantId: input.sourceParticipantId,
      sourceTrackSid: input.sourceTrackSid,
      targetParticipantId: input.target.id,
      type: input.event.type,
      segmentId: input.event.segmentId,
      revision: input.event.revision,
      sourceLanguage: input.event.sourceLanguage,
      targetLanguage: input.event.targetLanguage,
      sourceText: input.event.sourceText,
      text: input.event.text,
    });
    const inserted = await this.session.query<TranslationEventRow>(`
      INSERT INTO enterprise.meeting_translation_events(
        tenant_id, id, meeting_id, communication_session_id,
        dispatch_grant_id, route_epoch, generation, event_key, event_type,
        source_participant_id, source_display_name, source_track_sid,
        target_participant_id,
        segment_id, revision, source_language, target_language,
        source_text, caption_text, translated_audio_enabled,
        translated_audio_status, playback_generation, occurred_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
      ) ON CONFLICT DO NOTHING RETURNING *
    `, [
      randomUUID(), input.meetingId, input.communicationSessionId,
      input.grant.id, input.grant.routeEpoch, input.grant.generation,
      eventKey, input.event.type, input.sourceParticipantId,
      input.sourceDisplayName, input.sourceTrackSid, input.target.id,
      input.event.segmentId,
      input.event.revision, input.event.sourceLanguage,
      input.event.targetLanguage, input.event.sourceText, input.event.text,
      audioEnabled, audioStatus, input.target.playbackGeneration,
      new Date(input.event.timestampMs).toISOString(), new Date().toISOString(),
    ]);
    const row = inserted.rows[0] ?? (await this.session.query<TranslationEventRow>(`
      SELECT * FROM enterprise.meeting_translation_events
      WHERE tenant_id = $1 AND meeting_id = $2
        AND target_participant_id = $3 AND dispatch_grant_id = $4
        AND source_participant_id = $5 AND source_track_sid = $6
        AND event_type = $7 AND segment_id = $8 AND revision = $9
    `, [input.meetingId, input.target.id, input.grant.id,
      input.sourceParticipantId, input.sourceTrackSid, input.event.type,
      input.event.segmentId, input.event.revision])).rows[0];
    if (!row) throw new Error("Enterprise meeting translation event replay lost");
    if (row.event_key !== eventKey) {
      throw new Error("Enterprise meeting translation event replay conflict");
    }
    return {
      event: mapEvent(row),
      destinationIdentity: enterpriseMeetingParticipantIdentity({
        participantId: input.target.id,
        role: input.target.role,
      }),
    };
  }

  private async activeParticipants(meetingId: string) {
    const result = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2
        AND joined_at IS NOT NULL AND left_at IS NULL
      ORDER BY id
    `, [meetingId]);
    return result.rows.map(mapParticipant);
  }

  private async participant(meetingId: string, participantId: string, lock: boolean) {
    const result = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [meetingId, participantId]);
    return result.rows[0] ? mapParticipant(result.rows[0]) : null;
  }

  private async participantForActor(meetingId: string) {
    const actor = this.session.context.actorUserId;
    const result = await this.session.query<ParticipantRow>(`
      SELECT * FROM enterprise.meeting_participants
      WHERE tenant_id = $1 AND meeting_id = $2
        AND (user_id = $3 OR external_identity = $3) FOR UPDATE
    `, [meetingId, actor]);
    if (result.rows.length > 1) {
      throw new Error("Enterprise meeting actor has duplicate participants");
    }
    return result.rows[0] ? mapParticipant(result.rows[0]) : null;
  }
}

function ownsParticipant(
  session: EnterpriseTenantPostgresSession,
  participant: EnterpriseMeetingParticipantRecord,
) {
  return participant.userId === session.context.actorUserId ||
    participant.externalIdentity === session.context.actorUserId;
}

function normalizeEvent(input: EnterpriseMeetingWorkerCaptionInput) {
  const now = Date.now();
  if (!["transcript.final", "translation.final"].includes(input.type) ||
    !["zh", "en"].includes(input.sourceLanguage) ||
    !["zh", "en"].includes(input.targetLanguage) ||
    input.sourceLanguage === input.targetLanguage ||
    !Number.isSafeInteger(input.revision) || input.revision < 0 ||
    !Number.isSafeInteger(input.timestampMs) ||
    Math.abs(input.timestampMs - now) > 300_000) {
    throw new Error("Invalid enterprise meeting translation event");
  }
  return {
    ...input,
    segmentId: bounded(input.segmentId, 160),
    sourceText: bounded(input.sourceText, 8_000),
    text: bounded(input.text, 8_000),
  };
}

function mapParticipant(row: ParticipantRow): EnterpriseMeetingParticipantRecord {
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    userId: row.user_id ?? undefined,
    externalIdentity: row.external_identity ?? undefined,
    role: row.role, language: row.language ?? undefined,
    captionLanguage: row.caption_language,
    translatedAudioEnabled: row.translated_audio_enabled,
    playbackGeneration: Number(row.playback_generation),
    displayName: row.display_name,
    joinedAt: optionalIso(row.joined_at), leftAt: optionalIso(row.left_at),
    version: Number(row.version),
  };
}

function mapEvent(row: TranslationEventRow): EnterpriseMeetingCaptionEvent {
  return {
    v: 1, eventId: row.id, type: row.event_type,
    meetingId: row.meeting_id,
    communicationSessionId: row.communication_session_id,
    targetParticipantId: row.target_participant_id,
    sourceParticipantId: row.source_participant_id,
    sourceDisplayName: row.source_display_name,
    sourceTrackSid: row.source_track_sid,
    generation: Number(row.generation), segmentId: row.segment_id,
    revision: row.revision, sourceLanguage: row.source_language,
    targetLanguage: row.target_language, sourceText: row.source_text,
    text: row.caption_text, translated: row.event_type === "translation.final",
    final: true, occurredAt: iso(row.occurred_at),
    translatedAudio: {
      enabled: row.translated_audio_enabled,
      available: row.translated_audio_status === "queued",
      status: row.translated_audio_status,
      playbackGeneration: Number(row.playback_generation),
    },
  };
}

function uuid(value: unknown) {
  const result = bounded(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(result)) throw new Error("Invalid enterprise meeting translation ID");
  return result;
}
function bounded(value: unknown, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || Buffer.byteLength(result) > max) {
    throw new Error("Invalid enterprise meeting translation value");
  }
  return result;
}
function iso(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid enterprise meeting translation time");
  }
  return date.toISOString();
}
function optionalIso(value: string | Date | null) {
  return value ? iso(value) : undefined;
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

interface ParticipantRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; user_id: string | null;
  external_identity: string | null; role: "host" | "member" | "guest";
  language: string | null; caption_language: EnterpriseMeetingCaptionLanguage;
  translated_audio_enabled: boolean; playback_generation: string | number;
  display_name: string; joined_at: string | Date | null;
  left_at: string | Date | null; version: string | number;
}
interface TranslationEventRow extends Record<string, unknown> {
  id: string; meeting_id: string; communication_session_id: string;
  event_key: string;
  generation: string | number; event_type: "transcript.final" | "translation.final";
  source_participant_id: string; source_track_sid: string;
  source_display_name: string;
  target_participant_id: string; segment_id: string; revision: number;
  source_language: EnterpriseMeetingCaptionLanguage;
  target_language: EnterpriseMeetingCaptionLanguage;
  source_text: string; caption_text: string;
  translated_audio_enabled: boolean;
  translated_audio_status: "disabled" | "not_ready" | "queued";
  playback_generation: string | number; occurred_at: string | Date;
}
