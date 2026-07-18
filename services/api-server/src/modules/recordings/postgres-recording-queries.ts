import type { Pool, QueryResultRow } from "pg";
import type {
  ParticipantRecordingConsentDto,
  RecordingJobDto,
} from "@translation/contracts";
import { PostgresPrimaryStore } from
  "../../infrastructure/storage/postgres-primary-store.js";
import { bounded } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  activeRecordingStatuses,
  requireRecordingConsent,
  requireRecordingJob,
} from "./postgres-recording-uow.js";

export class PostgresRecordingQueries {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  findJob(jobId: string) {
    return this.primary.read<RecordingJobDto>("recordingJobs", jobId)
      .then((record) => record ? requireRecordingJob(record.payload, jobId) : null);
  }

  async latestConsents(sessionId: string) {
    if (!bounded(sessionId, 160)) throw new Error("Invalid recording session id");
    const client = await this.pool.connect();
    try {
      const rows = await client.query<ConsentRow>(`
        SELECT DISTINCT ON (consent.participant_identity)
          consent.id, primary_record.payload
        FROM ai_phone.participant_recording_consents AS consent
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'participantRecordingConsents'
          AND primary_record.record_key = consent.id
        WHERE consent.session_id = $1
        ORDER BY consent.participant_identity,
          primary_record.updated_at DESC, consent.id DESC
      `, [sessionId]);
      return new Map(rows.rows.map((row) => {
        const consent = requireRecordingConsent(row.payload, row.id);
        return [consent.participantIdentity, consent] as const;
      }));
    } finally {
      client.release();
    }
  }

  async findJobByExternalId(externalRecordingId: string) {
    if (!bounded(externalRecordingId, 500)) {
      throw new Error("Invalid external recording id");
    }
    const jobs = await this.queryJobs(`
      WHERE job.external_recording_id = $1
      ORDER BY job.updated_at DESC, job.id LIMIT 1
    `, [externalRecordingId]);
    return jobs[0] ?? null;
  }

  listSessionJobs(sessionId: string) {
    if (!bounded(sessionId, 160)) throw new Error("Invalid recording session id");
    return this.queryJobs(`
      WHERE job.session_id = $1 ORDER BY job.created_at, job.id
    `, [sessionId]);
  }

  listRecoverableJobs(limit = 200) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid recording recovery limit");
    }
    return this.queryJobs(`
      WHERE job.status = ANY($1::text[])
        AND job.external_recording_id IS NOT NULL
      ORDER BY job.updated_at, job.id LIMIT $2
    `, [[...activeRecordingStatuses], limit]);
  }

  private async queryJobs(where: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      const rows = await client.query<JobRow>(`
        SELECT job.id, primary_record.payload
        FROM ai_phone.recording_jobs AS job
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'recordingJobs'
          AND primary_record.record_key = job.id
        ${where}
      `, values);
      return rows.rows.map((row) => requireRecordingJob(row.payload, row.id));
    } finally {
      client.release();
    }
  }
}

interface ConsentRow extends QueryResultRow { id: string; payload: unknown }
interface JobRow extends QueryResultRow { id: string; payload: unknown }
