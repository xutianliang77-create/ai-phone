import type {
  ParticipantRecordingConsentDto,
  RecordingArtifactDto,
  RecordingJobDto,
} from "@translation/contracts";
import { describe, expect, it, vi } from "vitest";
import { PostgresRecordingArtifactsRepository } from
  "./postgres-recording-artifacts.repository.js";
import { PostgresRecordingQueries } from "./postgres-recording-queries.js";

describe("Postgres recording queries", () => {
  it("returns the latest consent keyed by participant", async () => {
    const fixture = pool([{ id: consent.id, payload: consent }]);
    const result = await new PostgresRecordingQueries(fixture.pool)
      .latestConsents("session_1");

    expect(result.get("host")).toEqual(consent);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("DISTINCT ON (consent.participant_identity)"),
      ["session_1"],
    );
  });

  it("finds a recording job by external id", async () => {
    const fixture = pool([{ id: job.id, payload: job }]);
    await expect(new PostgresRecordingQueries(fixture.pool)
      .findJobByExternalId("egress_1")).resolves.toEqual(job);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("job.external_recording_id = $1"),
      ["egress_1"],
    );
  });

  it("lists recoverable jobs with an explicit bound", async () => {
    const fixture = pool([]);
    await expect(new PostgresRecordingQueries(fixture.pool)
      .listRecoverableJobs(25)).resolves.toEqual([]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("job.external_recording_id IS NOT NULL"),
      [expect.any(Array), 25],
    );
  });

  it("lists artifacts by recording job and releases the connection", async () => {
    const fixture = pool([{ id: artifact.id, payload: artifact }]);
    await expect(new PostgresRecordingArtifactsRepository(fixture.pool)
      .listJob("recording_1")).resolves.toEqual([artifact]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("artifact.recording_job_id = $1"),
      ["recording_1"],
    );
    expect(fixture.release).toHaveBeenCalledOnce();
  });
});

const consent: ParticipantRecordingConsentDto = {
  id: "consent_1",
  sessionId: "session_1",
  participantIdentity: "host",
  policyVersion: "policy_1",
  status: "granted",
  grantedAt: "2026-07-17T00:00:00.000Z",
  createdAt: "2026-07-17T00:00:00.000Z",
};

const job: RecordingJobDto = {
  id: "recording_1",
  sessionId: "session_1",
  roomName: "room_1",
  recordingType: "room_audio",
  provider: "livekit_egress",
  consentSnapshotId: "snapshot_1",
  retentionUntil: "2027-07-17T00:00:00.000Z",
  objectKey: "recordings/session_1/audio.ogg",
  contentType: "audio/ogg",
  status: "active",
  idempotencyKey: "recording_1",
  requestHash: "request-hash-at-least-sixteen-bytes",
  externalRecordingId: "egress_1",
  version: 2,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:01:00.000Z",
};

const artifact: RecordingArtifactDto = {
  id: "artifact_1",
  recordingJobId: job.id,
  sessionId: job.sessionId,
  objectKey: job.objectKey,
  contentType: "audio/ogg",
  status: "available",
  verificationAttempts: 0,
  deletionAttempts: 0,
  createdAt: "2026-07-17T00:01:00.000Z",
  updatedAt: "2026-07-17T00:01:00.000Z",
};

function pool(rows: Array<{ id: string; payload: unknown }>) {
  const query = vi.fn().mockResolvedValue({ rows });
  const release = vi.fn();
  return {
    pool: {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never,
    query,
    release,
  };
}
