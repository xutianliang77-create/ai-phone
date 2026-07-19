import type {
  EnterpriseMeetingMaterialReview,
  EnterpriseMeetingMaterialSourceSegment,
} from "../../modules/enterprise/enterprise-meeting-material.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  findMeetingMaterialRun,
  loadMeetingMaterial,
  mapRun,
  meetingMaterialSourceSegments,
  type RunRow,
} from "./enterprise-postgres-meeting-material-read.js";
import {
  canManageMeetingMaterial as canManage,
  materialHash as hash,
  materialIso as iso,
  materialKey as key,
  materialText as text,
  materialUuid as uuid,
  validateMeetingMaterialReview as validateReview,
  type MeetingMaterialMeetingRow as MeetingRow,
} from "./enterprise-postgres-meeting-material-validation.js";
import {
  advanceMeetingMaterialRun,
  insertMeetingMaterialArtifacts,
  insertMeetingMaterialReview,
  insertMeetingMaterialSegments,
} from "./enterprise-postgres-meeting-material-write.js";

export class EnterpriseMeetingMaterialPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  sourceSegments(meetingId: string) {
    return meetingMaterialSourceSegments(this.session, uuid(meetingId));
  }

  async prepare(input: {
    runId: string;
    meetingId: string;
    expectedMeetingVersion: number;
    sourceEventCount: number;
    sourceHash: string;
    idempotencyKey: string;
    requestHash: string;
    createdAt: string;
  }) {
    const meeting = await this.manageableMeeting(input.meetingId, true);
    if (!meeting) return { status: "not_found" as const };
    if (!canManage(this.session, meeting.host_user_id)) {
      return { status: "forbidden" as const };
    }
    const existing = await findMeetingMaterialRun(this.session, {
      meetingId: input.meetingId, idempotencyKey: input.idempotencyKey, lock: true,
    });
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        return { status: "idempotency_conflict" as const };
      }
      const finalized = existing.reviewStatus !== "processing";
      return {
        status: "replayed" as const,
        run: existing,
        finalized,
        ...(finalized
          ? { material: await loadMeetingMaterial(this.session, existing) } : {}),
      };
    }
    if (meeting.status !== "ended") return { status: "not_ended" as const };
    if (meeting.version !== input.expectedMeetingVersion) {
      return { status: "conflict" as const };
    }
    if (input.sourceEventCount < 1) return { status: "no_source_events" as const };
    const createdAt = iso(input.createdAt);
    const inserted = await this.session.query<RunRow>(`
      INSERT INTO enterprise.meeting_material_runs(
        tenant_id, id, meeting_id, revision, status,
        source_event_count, source_hash, review_status, review_reason_code,
        retention_until, created_by, idempotency_key, request_hash,
        created_at, updated_at, version
      ) SELECT $1, $2, $3,
        COALESCE(MAX(existing.revision), 0) + 1, 'draft',
        $4, $5, 'processing', 'material_review_processing',
        $6, $7, $8, $9, $10, $10, 1
      FROM enterprise.meeting_material_runs existing
      WHERE existing.tenant_id = $1 AND existing.meeting_id = $3
      RETURNING *
    `, [uuid(input.runId), uuid(input.meetingId), input.sourceEventCount,
      hash(input.sourceHash), meeting.retention_until,
      this.session.context.actorUserId, key(input.idempotencyKey),
      hash(input.requestHash), createdAt]);
    const run = inserted.rows[0];
    if (!run) throw new Error("Enterprise meeting material run was not created");
    return { status: "created" as const, run: mapRun(run) };
  }

  async finalize(input: {
    meetingId: string;
    runId: string;
    expectedVersion: number;
    sourceHash: string;
    segments: EnterpriseMeetingMaterialSourceSegment[];
    review: EnterpriseMeetingMaterialReview;
    occurredAt: string;
  }) {
    const run = await findMeetingMaterialRun(this.session, {
      meetingId: input.meetingId, runId: input.runId, lock: true,
    });
    if (!run) return { status: "not_found" as const };
    if (run.reviewStatus !== "processing") {
      return { status: "replayed" as const, material: await loadMeetingMaterial(
        this.session, run,
      ) };
    }
    if (run.version !== input.expectedVersion || run.sourceHash !== input.sourceHash ||
      run.sourceEventCount !== input.segments.length) {
      return { status: "conflict" as const };
    }
    const occurredAt = iso(input.occurredAt);
    const evidenceIds = new Set(input.segments.map((segment) => segment.id));
    validateReview(input.review, evidenceIds);
    await insertMeetingMaterialSegments(
      this.session, run, input.segments, occurredAt,
    );
    await insertMeetingMaterialReview(
      this.session, run, input.review, evidenceIds, occurredAt,
    );
    const updated = await this.session.query<RunRow>(`
      UPDATE enterprise.meeting_material_runs
      SET review_status = $4, review_reason_code = $5,
        provider_fingerprint = $6, updated_at = $7, version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
        AND version = $8 AND review_status = 'processing'
      RETURNING *
    `, [run.meetingId, run.id, input.review.status,
      input.review.reasonCode ?? null, input.review.providerFingerprint ?? null,
      occurredAt, run.version]);
    if (!updated.rows[0]) return { status: "conflict" as const };
    await insertMeetingMaterialArtifacts(
      this.session, mapRun(updated.rows[0]), input.review, occurredAt,
    );
    return {
      status: "finalized" as const,
      material: await loadMeetingMaterial(this.session, mapRun(updated.rows[0])),
    };
  }

  async current(meetingId: string) {
    const meeting = await this.manageableMeeting(meetingId, false, false);
    if (!meeting) return { status: "not_found" as const };
    const run = await findMeetingMaterialRun(this.session, {
      meetingId,
      publishedOnly: !canManage(this.session, meeting.host_user_id),
    });
    return {
      status: "ready" as const,
      material: run ? await loadMeetingMaterial(this.session, run) : null,
    };
  }

  async publish(input: {
    meetingId: string; runId: string; expectedVersion: number; occurredAt: string;
  }) {
    const meeting = await this.manageableMeeting(input.meetingId, true);
    if (!meeting) return { status: "not_found" as const };
    if (!canManage(this.session, meeting.host_user_id)) {
      return { status: "forbidden" as const };
    }
    const run = await findMeetingMaterialRun(this.session, {
      meetingId: input.meetingId, runId: input.runId, lock: true,
    });
    if (!run) return { status: "not_found" as const };
    if (run.status === "published") {
      if (input.expectedVersion !== run.version &&
        input.expectedVersion !== run.version - 1) {
        return { status: "conflict" as const };
      }
      return { status: "published" as const,
        material: await loadMeetingMaterial(this.session, run), replayed: true as const };
    }
    if (run.reviewStatus !== "ready") return { status: "review_not_ready" as const };
    if (run.version !== input.expectedVersion) return { status: "conflict" as const };
    const occurredAt = iso(input.occurredAt);
    const updated = await this.session.query<RunRow>(`
      UPDATE enterprise.meeting_material_runs
      SET status = 'published', published_at = $4, updated_at = $4,
        version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
        AND version = $5 AND status = 'draft'
      RETURNING *
    `, [run.meetingId, run.id, occurredAt, run.version]);
    if (!updated.rows[0]) return { status: "conflict" as const };
    await this.session.query(`
      UPDATE enterprise.meeting_artifacts
      SET status = 'published', published_at = $4, version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND object_id = $3
        AND status = 'ready'
    `, [run.meetingId, run.id, occurredAt]);
    const next = mapRun(updated.rows[0]);
    return { status: "published" as const,
      material: await loadMeetingMaterial(this.session, next) };
  }

  async updateSpeaker(input: {
    meetingId: string; runId: string; participantId: string;
    displayName: string; expectedVersion: number; occurredAt: string;
  }) {
    const meeting = await this.manageableMeeting(input.meetingId, true);
    if (!meeting) return { status: "not_found" as const };
    if (!canManage(this.session, meeting.host_user_id)) {
      return { status: "forbidden" as const };
    }
    const run = await findMeetingMaterialRun(this.session, {
      meetingId: input.meetingId, runId: input.runId, lock: true,
    });
    if (!run) return { status: "not_found" as const };
    if (run.version !== input.expectedVersion) return { status: "conflict" as const };
    const occurredAt = iso(input.occurredAt);
    const label = await this.session.query(`
      UPDATE enterprise.meeting_material_speaker_labels
      SET display_name = $5, updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND material_run_id = $3
        AND participant_id = $4
      RETURNING id
    `, [run.meetingId, run.id, uuid(input.participantId),
      text(input.displayName, 120), occurredAt]);
    if (!label.rows[0]) return { status: "not_found" as const };
    const updated = await advanceMeetingMaterialRun(
      this.session, run, occurredAt,
    );
    if (!updated) return { status: "conflict" as const };
    return { status: "updated" as const,
      material: await loadMeetingMaterial(this.session, updated) };
  }

  async updateAction(input: {
    meetingId: string; runId: string; actionItemId: string;
    status: "open" | "completed" | "cancelled";
    expectedVersion: number; occurredAt: string;
  }) {
    const meeting = await this.manageableMeeting(input.meetingId, false);
    if (!meeting) return { status: "not_found" as const };
    if (!canManage(this.session, meeting.host_user_id)) {
      return { status: "forbidden" as const };
    }
    const occurredAt = iso(input.occurredAt);
    const updated = await this.session.query(`
      UPDATE enterprise.meeting_action_items
      SET status = $5, updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND material_run_id = $3
        AND id = $4 AND version = $7
      RETURNING id
    `, [uuid(input.meetingId), uuid(input.runId), uuid(input.actionItemId),
      input.status, occurredAt, input.expectedVersion]);
    if (!updated.rows[0]) return { status: "conflict" as const };
    const run = await findMeetingMaterialRun(this.session, {
      meetingId: input.meetingId, runId: input.runId,
    });
    if (!run) return { status: "not_found" as const };
    return { status: "updated" as const,
      material: await loadMeetingMaterial(this.session, run) };
  }

  private async manageableMeeting(meetingId: string, lock: boolean, requireActor = true) {
    const result = await this.session.query<MeetingRow>(`
      SELECT id, host_user_id, status, version, retention_until
      FROM enterprise.meetings
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(meetingId)]);
    if (!result.rows[0]) return null;
    if (requireActor && this.session.context.actorUserId.startsWith("guest:")) return null;
    return result.rows[0];
  }
}
