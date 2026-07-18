import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import {
  listRecordingArtifacts,
} from "./recording-artifacts-runtime.repository.js";
import { applyRecordingProviderJob } from "./livekit-egress-reconciliation.js";
import {
  beginRecordingJob,
  createRecordingConsentSnapshot,
  findRecordingJob,
  latestParticipantRecordingConsents,
  recordParticipantRecordingConsent,
  updateRecordingJob,
} from "./recordings-runtime.repository.js";

describe("recording runtime repository", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.participantRecordingConsents = [];
    store.recordingConsentSnapshots = [];
    store.recordingJobs = [];
    store.recordingArtifacts = [];
    store.providerOperations = [];
  });

  it("preserves the consent, job, and artifact flow on the legacy driver", async () => {
    const host = await consent("host");
    const guest = await consent("guest");
    const latest = await latestParticipantRecordingConsents("session_1");
    expect([...latest.keys()]).toEqual(["host", "guest"]);

    const snapshot = await createRecordingConsentSnapshot({
      sessionId: "session_1",
      policyVersion: "policy_1",
      participantConsents: [host, guest],
    });
    const begun = await beginRecordingJob({
      sessionId: "session_1",
      roomName: "room_1",
      recordingType: "room_audio",
      consentSnapshotId: snapshot.id,
      retentionUntil: "2027-07-17T00:00:00.000Z",
      objectKey: "recordings/session_1/audio.ogg",
      idempotencyKey: "recording_1",
      requestHash: "request-hash-at-least-sixteen-bytes",
    });
    expect(begun.status).toBe("created");
    if (begun.status !== "created") throw new Error("Recording was not created");

    const updated = await updateRecordingJob({
      jobId: begun.job.id,
      status: "starting",
      expectedVersion: begun.job.version,
      externalRecordingId: "egress_1",
    });
    expect(updated.status).toBe("updated");
    await applyRecordingProviderJob(begun.job.id, {
      recordingId: "egress_1",
      roomName: "room_1",
      status: "active",
      artifacts: [{ objectKey: begun.job.objectKey, sizeBytes: 512 }],
    });
    await expect(findRecordingJob(begun.job.id)).resolves.toMatchObject({
      status: "active",
    });
    await expect(listRecordingArtifacts(begun.job.id)).resolves.toMatchObject([
      { status: "available", sizeBytes: 512 },
    ]);
  });
});

function consent(participantIdentity: string) {
  return recordParticipantRecordingConsent({
    sessionId: "session_1",
    participantIdentity,
    policyVersion: "policy_1",
    granted: true,
  });
}
