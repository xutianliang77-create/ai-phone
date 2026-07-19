import type {
  EnterpriseMeetingMaterialActionItemRecord,
  EnterpriseMeetingMaterialConclusionRecord,
  EnterpriseMeetingMaterialRecord,
  EnterpriseMeetingMaterialRunRecord,
  EnterpriseMeetingMaterialSegmentRecord,
  EnterpriseMeetingMaterialSourceSegment,
} from "../../modules/enterprise/enterprise-meeting-material.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export async function meetingMaterialSourceSegments(
  session: EnterpriseTenantPostgresSession,
  meetingId: string,
): Promise<Omit<EnterpriseMeetingMaterialSourceSegment, "id">[]> {
  const result = await session.query<SourceRow>(`
    WITH ranked AS (
      SELECT event.*, dense_rank() OVER (
        PARTITION BY source_participant_id, source_track_sid, segment_id
        ORDER BY revision DESC
      ) AS revision_rank
      FROM enterprise.meeting_translation_events event
      WHERE tenant_id = $1 AND meeting_id = $2
    ), latest AS (
      SELECT * FROM ranked WHERE revision_rank = 1
    ), source_consistency AS (
      SELECT source_participant_id, source_track_sid, segment_id, revision,
        count(DISTINCT source_display_name) AS source_display_name_count,
        count(DISTINCT source_language) AS source_language_count,
        count(DISTINCT source_text) AS source_text_count
      FROM latest
      GROUP BY source_participant_id, source_track_sid, segment_id, revision
    ), canonical AS (
      SELECT DISTINCT ON (
        source_participant_id, source_track_sid, segment_id, revision
      ) source_participant_id, source_display_name, source_track_sid,
        segment_id, revision, source_language, source_text, occurred_at
      FROM latest
      ORDER BY source_participant_id, source_track_sid, segment_id, revision,
        CASE event_type WHEN 'transcript.final' THEN 0 ELSE 1 END,
        occurred_at, id
    ), translations AS (
      SELECT
        source_participant_id, source_track_sid, segment_id, revision,
        target_language, min(caption_text) AS caption_text,
        count(DISTINCT caption_text) AS translation_text_count
      FROM latest
      WHERE event_type = 'translation.final'
      GROUP BY source_participant_id, source_track_sid, segment_id, revision,
        target_language
    )
    SELECT canonical.*,
      source_consistency.source_display_name_count,
      source_consistency.source_language_count,
      source_consistency.source_text_count,
      COALESCE(max(translations.translation_text_count), 1)
        AS max_translation_text_count,
      COALESCE(jsonb_agg(jsonb_build_object(
        'language', translations.target_language,
        'text', translations.caption_text
      ) ORDER BY translations.target_language)
        FILTER (WHERE translations.target_language IS NOT NULL), '[]'::jsonb
      ) AS translations
    FROM canonical
    JOIN source_consistency USING (
      source_participant_id, source_track_sid, segment_id, revision
    )
    LEFT JOIN translations USING (
      source_participant_id, source_track_sid, segment_id, revision
    )
    GROUP BY canonical.source_participant_id, canonical.source_display_name,
      canonical.source_track_sid, canonical.segment_id, canonical.revision,
      canonical.source_language, canonical.source_text, canonical.occurred_at,
      source_consistency.source_display_name_count,
      source_consistency.source_language_count,
      source_consistency.source_text_count
    ORDER BY canonical.occurred_at, canonical.source_participant_id,
      canonical.source_track_sid, canonical.segment_id
  `, [meetingId]);
  return result.rows.map((row) => {
    if (Number(row.source_display_name_count) !== 1 ||
      Number(row.source_language_count) !== 1 ||
      Number(row.source_text_count) !== 1 ||
      Number(row.max_translation_text_count) !== 1) {
      throw new Error("Inconsistent meeting translation fan-out");
    }
    return {
      sourceParticipantId: row.source_participant_id,
      sourceDisplayName: row.source_display_name,
      sourceTrackSid: row.source_track_sid,
      sourceSegmentId: row.segment_id,
      revision: Number(row.revision),
      sourceLanguage: row.source_language,
      sourceText: row.source_text,
      translations: translationValues(row.translations),
      occurredAt: iso(row.occurred_at),
    };
  });
}

export async function findMeetingMaterialRun(
  session: EnterpriseTenantPostgresSession,
  input: { meetingId: string; runId?: string; idempotencyKey?: string;
    lock?: boolean; publishedOnly?: boolean },
) {
  const selector = input.runId
    ? "id = $3"
    : input.idempotencyKey
      ? "idempotency_key = $3"
      : "TRUE";
  const parameters = input.runId
    ? [input.meetingId, input.runId]
    : input.idempotencyKey
      ? [input.meetingId, input.idempotencyKey]
      : [input.meetingId];
  const result = await session.query<RunRow>(`
    SELECT * FROM enterprise.meeting_material_runs
    WHERE tenant_id = $1 AND meeting_id = $2 AND ${selector}
      ${input.publishedOnly ? "AND status = 'published'" : ""}
    ORDER BY revision DESC, created_at DESC, id DESC
    LIMIT 1 ${input.lock ? "FOR UPDATE" : ""}
  `, parameters);
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function loadMeetingMaterial(
  session: EnterpriseTenantPostgresSession,
  run: EnterpriseMeetingMaterialRunRecord,
): Promise<EnterpriseMeetingMaterialRecord> {
  const [segments, conclusions, actions] = await Promise.all([
    materialSegments(session, run),
    materialConclusions(session, run),
    materialActions(session, run),
  ]);
  return { run, segments, conclusions, actionItems: actions };
}

async function materialSegments(
  session: EnterpriseTenantPostgresSession,
  run: EnterpriseMeetingMaterialRunRecord,
) {
  const result = await session.query<SegmentRow>(`
    SELECT segment.*,
      COALESCE(label.display_name, segment.source_display_name) AS speaker_label,
      COALESCE(jsonb_agg(jsonb_build_object(
        'language', translation.language, 'text', translation.translated_text
      ) ORDER BY translation.language)
        FILTER (WHERE translation.id IS NOT NULL), '[]'::jsonb) AS translations
    FROM enterprise.meeting_material_segments segment
    LEFT JOIN enterprise.meeting_material_speaker_labels label
      ON label.tenant_id = segment.tenant_id
      AND label.material_run_id = segment.material_run_id
      AND label.participant_id = segment.source_participant_id
    LEFT JOIN enterprise.meeting_material_segment_translations translation
      ON translation.tenant_id = segment.tenant_id
      AND translation.material_run_id = segment.material_run_id
      AND translation.material_segment_id = segment.id
    WHERE segment.tenant_id = $1 AND segment.material_run_id = $2
    GROUP BY segment.id, label.display_name
    ORDER BY segment.ordinal, segment.id
  `, [run.id]);
  return result.rows.map((row): EnterpriseMeetingMaterialSegmentRecord => ({
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    materialRunId: row.material_run_id, ordinal: Number(row.ordinal),
    sourceParticipantId: row.source_participant_id,
    speakerLabel: row.speaker_label,
    sourceTrackSid: row.source_track_sid,
    sourceSegmentId: row.source_segment_id, revision: Number(row.revision),
    sourceLanguage: row.source_language, sourceText: row.source_text,
    translations: translationValues(row.translations),
    occurredAt: iso(row.occurred_at),
  }));
}

async function materialConclusions(
  session: EnterpriseTenantPostgresSession,
  run: EnterpriseMeetingMaterialRunRecord,
) {
  const result = await session.query<ConclusionRow>(`
    SELECT conclusion.*,
      COALESCE(array_agg(evidence.material_segment_id ORDER BY evidence.id)
        FILTER (WHERE evidence.id IS NOT NULL), ARRAY[]::uuid[]) AS evidence_ids
    FROM enterprise.meeting_material_conclusions conclusion
    LEFT JOIN enterprise.meeting_material_conclusion_evidence evidence
      ON evidence.tenant_id = conclusion.tenant_id
      AND evidence.material_run_id = conclusion.material_run_id
      AND evidence.conclusion_id = conclusion.id
    WHERE conclusion.tenant_id = $1 AND conclusion.material_run_id = $2
    GROUP BY conclusion.id
    ORDER BY conclusion.kind, conclusion.ordinal, conclusion.id
  `, [run.id]);
  return result.rows.map((row): EnterpriseMeetingMaterialConclusionRecord => ({
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    materialRunId: row.material_run_id, kind: row.kind,
    ordinal: Number(row.ordinal), text: row.conclusion_text,
    evidenceSegmentIds: row.evidence_ids,
  }));
}

async function materialActions(
  session: EnterpriseTenantPostgresSession,
  run: EnterpriseMeetingMaterialRunRecord,
) {
  const result = await session.query<ActionRow>(`
    SELECT action.*,
      COALESCE(array_agg(evidence.material_segment_id ORDER BY evidence.id)
        FILTER (WHERE evidence.id IS NOT NULL), ARRAY[]::uuid[]) AS evidence_ids
    FROM enterprise.meeting_action_items action
    LEFT JOIN enterprise.meeting_action_item_evidence evidence
      ON evidence.tenant_id = action.tenant_id
      AND evidence.action_item_id = action.id
    WHERE action.tenant_id = $1 AND action.material_run_id = $2
    GROUP BY action.id
    ORDER BY action.ordinal, action.id
  `, [run.id]);
  return result.rows.map((row): EnterpriseMeetingMaterialActionItemRecord => ({
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    materialRunId: row.material_run_id, ordinal: Number(row.ordinal),
    text: row.item_text,
    ...(row.owner_participant_id
      ? { ownerParticipantId: row.owner_participant_id } : {}),
    ...(row.due_at ? { dueAt: iso(row.due_at) } : {}),
    ...(row.priority ? { priority: row.priority } : {}),
    status: row.status, evidenceSegmentIds: row.evidence_ids,
    version: Number(row.version), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export function mapRun(row: RunRow): EnterpriseMeetingMaterialRunRecord {
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    revision: Number(row.revision), status: row.status,
    sourceEventCount: Number(row.source_event_count), sourceHash: row.source_hash,
    reviewStatus: row.review_status,
    ...(row.review_reason_code ? { reviewReasonCode: row.review_reason_code } : {}),
    ...(row.provider_fingerprint
      ? { providerFingerprint: row.provider_fingerprint } : {}),
    ...(row.retention_until ? { retentionUntil: iso(row.retention_until) } : {}),
    createdBy: row.created_by, idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash, createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.published_at ? { publishedAt: iso(row.published_at) } : {}),
    version: Number(row.version),
  };
}

function translationValues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item as { language: "zh" | "en"; text: string });
}
function iso(value: string | Date) { return new Date(value).toISOString(); }

export interface RunRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; revision: number;
  status: "draft" | "published"; source_event_count: number;
  source_hash: string;
  review_status: EnterpriseMeetingMaterialRunRecord["reviewStatus"];
  review_reason_code: string | null; provider_fingerprint: string | null;
  retention_until: string | Date | null; created_by: string;
  idempotency_key: string; request_hash: string;
  created_at: string | Date; updated_at: string | Date;
  published_at: string | Date | null; version: number;
}
interface SourceRow extends Record<string, unknown> {
  source_participant_id: string; source_display_name: string;
  source_track_sid: string; segment_id: string; revision: number;
  source_language: "zh" | "en"; source_text: string;
  translations: unknown; occurred_at: string | Date;
  source_display_name_count: string | number;
  source_language_count: string | number; source_text_count: string | number;
  max_translation_text_count: string | number;
}
interface SegmentRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; material_run_id: string;
  ordinal: number; source_participant_id: string; speaker_label: string;
  source_track_sid: string; source_segment_id: string; revision: number;
  source_language: "zh" | "en"; source_text: string;
  translations: unknown; occurred_at: string | Date;
}
interface ConclusionRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; material_run_id: string;
  kind: EnterpriseMeetingMaterialConclusionRecord["kind"];
  ordinal: number; conclusion_text: string; evidence_ids: string[];
}
interface ActionRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; material_run_id: string;
  ordinal: number; item_text: string; owner_participant_id: string | null;
  due_at: string | Date | null; priority: "low" | "medium" | "high" | null;
  status: "open" | "completed" | "cancelled"; evidence_ids: string[];
  version: number; created_at: string | Date; updated_at: string | Date;
}
