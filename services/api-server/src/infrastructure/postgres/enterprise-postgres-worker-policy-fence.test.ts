import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  evaluateEnterpriseWorkerPolicyFence,
} from "./enterprise-postgres-worker-policy-fence.js";
import type {
  EnterpriseWorkerDispatchGrantRecord,
} from "./enterprise-postgres-worker-dispatch-record.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-07-18T06:00:00.000Z");

describe("enterprise worker policy fence", () => {
  it("returns the frozen policy only while readiness and evidence remain active", async () => {
    const result = await evaluateEnterpriseWorkerPolicyFence({
      session: session([policyRow()], [evidenceRow()]),
      grant: grant(),
      payload: payload(),
      now,
    });
    expect(result).toMatchObject({
      policy: {
        recordingEnabled: true,
        voiceIdentityEnabled: false,
        policyVersion: "policy-1",
      },
    });
  });

  it.each([
    ["invalidated", { status: "invalidated",
      invalidated_at: "2026-07-18T05:59:30.000Z" }, "policy_invalid"],
    ["expired", { readiness_expires_at: "2026-07-18T06:00:00.000Z" },
      "policy_expired"],
  ])("rejects an %s snapshot", async (_name, change, expected) => {
    await expect(evaluateEnterpriseWorkerPolicyFence({
      session: session([policyRow(change)], [evidenceRow()]),
      grant: grant(),
      payload: payload(),
      now,
    })).resolves.toEqual({ rejected: expected });
  });

  it("rejects revoked authorization before a sensitive side effect", async () => {
    await expect(evaluateEnterpriseWorkerPolicyFence({
      session: session([policyRow()], [evidenceRow({
        revoked_at: "2026-07-18T05:59:30.000Z",
      })]),
      grant: grant(),
      payload: payload(),
      now,
    })).resolves.toEqual({ rejected: "authorization_invalid" });
  });

  it("does not enable a disabled feature merely because evidence exists", async () => {
    const result = await evaluateEnterpriseWorkerPolicyFence({
      session: session([
        policyRow({ recording_enabled: false }),
      ], [evidenceRow({ purpose: "voice_identity" })]),
      grant: grant(),
      payload: payload(),
      now,
    });
    expect(result).toMatchObject({
      policy: { voiceIdentityEnabled: false, recordingEnabled: false },
    });
  });
});

function session(
  policies: Array<Record<string, unknown>>,
  evidence: Array<Record<string, unknown>>,
): EnterpriseTenantPostgresSession {
  const query = async <Row extends Record<string, unknown>>(sql: string) => ({
    rows: (sql.includes("communication_policy_snapshots")
      ? policies
      : sql.includes("communication_authorization_evidence") ? evidence : []) as Row[],
  });
  return {
    context: createEnterpriseTenantContext({
      tenantId,
      actorUserId: "system:test",
      traceId: "trace-policy-fence",
    }),
    query,
    queryTenantRecord: query,
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  };
}

function payload(): EnterpriseWorkerDispatchTicketPayload {
  return {
    v: 3,
    ticketId: "00000000-0000-4000-8000-000000000011",
    tenantId,
    communicationSessionId: "enterprise-session-1",
    policySnapshotId: "00000000-0000-4000-8000-000000000021",
    policyVersion: "policy-1",
    entitlementVersion: "entitlement-1",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    generation: 3,
    capability: "translation_runtime",
    issuedAt: "2026-07-18T05:59:00.000Z",
    expiresAt: "2026-07-18T06:04:00.000Z",
  };
}

function grant(): EnterpriseWorkerDispatchGrantRecord {
  return {
    id: payload().ticketId,
    tenantId,
    communicationSessionId: payload().communicationSessionId,
    policySnapshotId: payload().policySnapshotId,
    policyVersion: payload().policyVersion,
    billingAccountId: tenantId,
    entitlementVersion: payload().entitlementVersion,
    dispatchId: "dispatch-1",
    capacityReservationId: "capacity-1",
    capability: payload().capability,
    cellId: payload().cellId,
    routeEpoch: payload().routeEpoch,
    generation: payload().generation,
    status: "accepted",
    idempotencyKey: "dispatch-1",
    requestHash: "a".repeat(64),
    issuedAt: payload().issuedAt,
    expiresAt: payload().expiresAt,
    leaseOwner: "worker-01",
    leaseExpiresAt: "2026-07-18T06:02:00.000Z",
    acceptedAt: "2026-07-18T05:59:30.000Z",
    updatedAt: "2026-07-18T05:59:30.000Z",
    version: 2,
  };
}

function policyRow(change: Record<string, unknown> = {}) {
  return {
    id: payload().policySnapshotId,
    tenant_id: tenantId,
    communication_session_id: payload().communicationSessionId,
    policy_version: payload().policyVersion,
    route_epoch: "7",
    generation: "3",
    asr_execution: "device",
    translation_execution: "cloud",
    tts_execution: "cloud",
    voice_identity_enabled: false,
    recording_enabled: true,
    diagnostic_audio_enabled: false,
    authorization_evidence_ids: [
      "00000000-0000-4000-8000-000000000031",
    ],
    allowed_capabilities: ["translation_runtime"],
    runtime_state: "full",
    reason_code: "policy_full_runtime",
    fingerprints: { "asr.device": "asr-v1" },
    readiness_expires_at: "2026-07-18T06:05:00.000Z",
    request_hash: "b".repeat(64),
    status: "active",
    created_at: "2026-07-18T05:59:00.000Z",
    invalidated_at: null,
    ...change,
  };
}

function evidenceRow(change: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000031",
    purpose: "recording",
    expires_at: "2026-07-18T07:00:00.000Z",
    revoked_at: null,
    ...change,
  };
}
