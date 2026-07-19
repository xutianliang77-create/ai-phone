import { randomUUID } from "node:crypto";
import type {
  EnterpriseMeetingMaterialReview,
  EnterpriseMeetingMaterialSourceSegment,
} from "../../modules/enterprise/enterprise-meeting-material.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  findMeetingMaterialRun,
  mapRun,
  type RunRow,
} from "./enterprise-postgres-meeting-material-read.js";
import {
  materialIso as iso,
  materialText as text,
  materialUuid as uuid,
  uniqueMeetingMaterialEvidence as uniqueEvidence,
} from "./enterprise-postgres-meeting-material-validation.js";

type MaterialRun = NonNullable<Awaited<ReturnType<typeof findMeetingMaterialRun>>>;

export async function insertMeetingMaterialSegments(
  session: EnterpriseTenantPostgresSession,
  run: MaterialRun,
  segments: EnterpriseMeetingMaterialSourceSegment[],
  createdAt: string,
) {
  for (const [ordinal, segment] of segments.entries()) {
    await session.query(`
      INSERT INTO enterprise.meeting_material_segments(
        tenant_id, id, meeting_id, material_run_id, ordinal,
        source_participant_id, source_display_name, source_track_sid,
        source_segment_id, revision, source_language, source_text,
        occurred_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [uuid(segment.id), run.meetingId, run.id, ordinal,
      uuid(segment.sourceParticipantId), text(segment.sourceDisplayName, 120),
      text(segment.sourceTrackSid, 128), text(segment.sourceSegmentId, 160),
      segment.revision, segment.sourceLanguage, text(segment.sourceText, 32_768),
      iso(segment.occurredAt), createdAt]);
    await session.query(`
      INSERT INTO enterprise.meeting_material_speaker_labels(
        tenant_id, id, meeting_id, material_run_id, participant_id,
        display_name, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 1)
      ON CONFLICT (tenant_id, material_run_id, participant_id) DO NOTHING
    `, [randomUUID(), run.meetingId, run.id, segment.sourceParticipantId,
      text(segment.sourceDisplayName, 120), createdAt]);
    for (const translation of segment.translations) {
      await session.query(`
        INSERT INTO enterprise.meeting_material_segment_translations(
          tenant_id, id, meeting_id, material_run_id, material_segment_id,
          language, translated_text, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [randomUUID(), run.meetingId, run.id, segment.id,
        translation.language, text(translation.text, 32_768), createdAt]);
    }
  }
}

export async function insertMeetingMaterialReview(
  session: EnterpriseTenantPostgresSession,
  run: MaterialRun,
  review: EnterpriseMeetingMaterialReview,
  evidenceIds: Set<string>,
  createdAt: string,
) {
  const ordinals = new Map<string, number>();
  for (const conclusion of review.conclusions) {
    const id = randomUUID();
    const ordinal = ordinals.get(conclusion.kind) ?? 0;
    ordinals.set(conclusion.kind, ordinal + 1);
    await session.query(`
      INSERT INTO enterprise.meeting_material_conclusions(
        tenant_id, id, meeting_id, material_run_id, kind, ordinal,
        conclusion_text, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, run.meetingId, run.id, conclusion.kind, ordinal,
      text(conclusion.text, 2_000), createdAt]);
    for (const segmentId of uniqueEvidence(
      conclusion.evidenceSourceSegmentIds, evidenceIds,
    )) {
      await session.query(`
        INSERT INTO enterprise.meeting_material_conclusion_evidence(
          tenant_id, id, meeting_id, material_run_id, conclusion_id,
          material_segment_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomUUID(), run.meetingId, run.id, id, segmentId, createdAt]);
    }
  }
  await insertMeetingMaterialActions(
    session, run, review, evidenceIds, createdAt,
  );
}

async function insertMeetingMaterialActions(
  session: EnterpriseTenantPostgresSession,
  run: MaterialRun,
  review: EnterpriseMeetingMaterialReview,
  evidenceIds: Set<string>,
  createdAt: string,
) {
  for (const [ordinal, action] of review.actionItems.entries()) {
    const id = randomUUID();
    const evidence = uniqueEvidence(action.evidenceSourceSegmentIds, evidenceIds);
    await session.query(`
      INSERT INTO enterprise.meeting_action_items(
        tenant_id, id, meeting_id, owner_participant_id, item_text, due_at,
        status, evidence_segment_ids, version, material_run_id, ordinal,
        priority, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7::uuid[], 1, $8, $9, $10, $11, $11)
    `, [id, run.meetingId, action.ownerParticipantId ?? null,
      text(action.text, 2_000), action.dueAt ?? null, evidence,
      run.id, ordinal, action.priority ?? null, createdAt]);
    for (const segmentId of evidence) {
      await session.query(`
        INSERT INTO enterprise.meeting_action_item_evidence(
          tenant_id, id, meeting_id, material_run_id, action_item_id,
          material_segment_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomUUID(), run.meetingId, run.id, id, segmentId, createdAt]);
    }
  }
}

export async function insertMeetingMaterialArtifacts(
  session: EnterpriseTenantPostgresSession,
  run: MaterialRun,
  review: EnterpriseMeetingMaterialReview,
  createdAt: string,
) {
  const types = ["transcript",
    ...(review.conclusions.length > 0 ? ["summary"] : []),
    ...(review.actionItems.length > 0 ? ["action_items"] : [])];
  for (const artifactType of types) {
    await session.query(`
      INSERT INTO enterprise.meeting_artifacts(
        tenant_id, id, meeting_id, artifact_type, object_id,
        provider_fingerprint, status, created_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, 1)
    `, [randomUUID(), run.meetingId, artifactType, run.id,
      review.providerFingerprint ?? null, createdAt]);
  }
}

export async function advanceMeetingMaterialRun(
  session: EnterpriseTenantPostgresSession,
  run: MaterialRun,
  occurredAt: string,
) {
  const result = await session.query<RunRow>(`
    UPDATE enterprise.meeting_material_runs
    SET updated_at = $4, version = version + 1
    WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3 AND version = $5
    RETURNING *
  `, [run.meetingId, run.id, occurredAt, run.version]);
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}
