import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseCommunicationPolicyPostgresRepository,
} from "./enterprise-postgres-communication-policy.repository.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const evidenceId = "00000000-0000-4000-8000-000000000031";
const now = new Date("2026-07-18T06:00:00.000Z");

describe("enterprise PostgreSQL communication policy", () => {
  it("resolves and freezes a tenant/version policy with verified evidence", async () => {
    const fixture = policyFixture();
    const repository = new EnterpriseCommunicationPolicyPostgresRepository(
      fixture.session,
    );

    const result = await repository.resolve({
      communicationSessionId: "enterprise-session-1",
      authorizationEvidenceIds: [evidenceId],
      readiness: readiness(),
      now,
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected policy snapshot");
    expect(result.snapshot).toMatchObject({
      tenantId,
      communicationSessionId: "enterprise-session-1",
      policyVersion: "policy-1",
      routeEpoch: 7,
      generation: 3,
      recordingEnabled: true,
      voiceIdentityEnabled: false,
      allowedCapabilities: ["translation_runtime", "voice_agent_runtime"],
    });
    expect(fixture.calls.some(({ sql, values }) =>
      sql.includes("INSERT INTO enterprise.communication_policy_snapshots") &&
      values?.includes(evidenceId) === false &&
      Array.isArray(values?.[11]) && values?.[11]?.includes(evidenceId)
    )).toBe(true);
  });

  it("rejects missing or revoked evidence without storing a snapshot", async () => {
    const fixture = policyFixture({ evidence: [] });
    const repository = new EnterpriseCommunicationPolicyPostgresRepository(
      fixture.session,
    );

    await expect(repository.resolve({
      communicationSessionId: "enterprise-session-1",
      authorizationEvidenceIds: [evidenceId],
      readiness: readiness(),
      now,
    })).resolves.toEqual({ status: "authorization_invalid" });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.communication_policy_snapshots")
    )).toBe(false);
  });

  it("records purpose-bound evidence and revokes it through the invalidating trigger", async () => {
    const fixture = policyFixture();
    const repository = new EnterpriseCommunicationPolicyPostgresRepository(
      fixture.session,
    );
    const createdAt = "2026-07-18T05:59:00.000Z";
    await expect(repository.recordAuthorization({
      id: evidenceId,
      communicationSessionId: "enterprise-session-1",
      policyVersion: "policy-1",
      purpose: "recording",
      evidenceHash: "a".repeat(64),
      subjectSetHash: "b".repeat(64),
      grantedAt: createdAt,
      expiresAt: "2026-07-18T07:00:00.000Z",
      createdAt,
    })).resolves.toEqual({ status: "created", id: evidenceId });
    await expect(repository.revokeAuthorization({
      id: evidenceId,
      revokedAt: "2026-07-18T06:01:00.000Z",
    })).resolves.toEqual({ status: "revoked", id: evidenceId });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("SET revoked_at = $3")
    )).toBe(true);
  });
});

function policyFixture(input: {
  evidence?: Array<Record<string, unknown>>;
} = {}) {
  const calls: Call[] = [];
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "system:test",
    traceId: "trace-policy-1",
  });
  const evidence = input.evidence ?? [{
    id: evidenceId,
    purpose: "recording",
    expires_at: "2026-07-18T07:00:00.000Z",
    revoked_at: null,
  }];
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Array<Record<string, unknown>> = [];
    if (sql.includes("communication_session_bindings")) rows = [bindingRow()];
    else if (sql.includes("SELECT * FROM enterprise.communication_policy_snapshots")) {
      rows = [];
    } else if (sql.includes("communication_policy_versions")) {
      rows = [policyVersionRow()];
    } else if (sql.includes("SELECT id, purpose")) rows = evidence;
    else if (sql.includes("INSERT INTO enterprise.communication_policy_snapshots")) {
      rows = [snapshotRow(values)];
    } else if (sql.includes("INSERT INTO enterprise.communication_authorization_evidence")) {
      rows = [{ id: evidenceId }];
    } else if (sql.includes("SELECT revoked_at")) rows = [{ revoked_at: null }];
    else if (sql.includes("SET revoked_at = $3")) rows = [{ id: evidenceId }];
    return { rows: rows as Row[] };
  };
  const session = {
    context,
    query,
    queryTenantRecord: query,
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
  return { calls, session };
}

function bindingRow() {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    tenant_id: tenantId,
    scope_type: "tenant",
    scope_id: tenantId,
    communication_session_id: "enterprise-session-1",
    kind: "meeting",
    meeting_id: "00000000-0000-4000-8000-000000000013",
    support_session_id: null,
    marketing_call_task_id: null,
    status: "active",
    home_region: "cn-north",
    cell_id: "cn-cell-01",
    route_epoch: "7",
    policy_version: "policy-1",
    entitlement_version: "entitlement-1",
    generation: "3",
    last_event_sequence: "9",
    last_event_at: "2026-07-18T05:59:00.000Z",
    started_at: "2026-07-18T05:55:00.000Z",
    ended_at: null,
    updated_at: "2026-07-18T05:59:00.000Z",
    version: "4",
  };
}

function policyVersionRow() {
  return {
    id: "00000000-0000-4000-8000-000000000021",
    tenant_id: tenantId,
    policy_version: "policy-1",
    asr_preference: "prefer_device",
    translation_preference: "prefer_cloud",
    tts_preference: "prefer_cloud",
    voice_identity_mode: "consent_required",
    recording_mode: "consent_required",
    diagnostic_audio_mode: "consent_required",
    allow_captions_only: true,
    allow_half_duplex: false,
  };
}

function snapshotRow(values: unknown[]) {
  return {
    id: values[0],
    tenant_id: tenantId,
    communication_session_id: values[1],
    policy_version: values[2],
    route_epoch: String(values[3]),
    generation: String(values[4]),
    asr_execution: values[5],
    translation_execution: values[6],
    tts_execution: values[7],
    voice_identity_enabled: values[8],
    recording_enabled: values[9],
    diagnostic_audio_enabled: values[10],
    authorization_evidence_ids: values[11],
    allowed_capabilities: values[12],
    runtime_state: values[13],
    reason_code: values[14],
    fingerprints: JSON.parse(String(values[15])),
    readiness_expires_at: values[16],
    request_hash: values[17],
    status: "active",
    created_at: values[18],
    invalidated_at: null,
  };
}

function readiness() {
  const ready = (fingerprint: string) => ({
    status: "ready" as const,
    fingerprint,
    checkedAt: "2026-07-18T05:59:00.000Z",
    expiresAt: "2026-07-18T06:05:00.000Z",
  });
  return {
    asr: { device: ready("asr-device-v1"), cloud: ready("asr-cloud-v1") },
    translation: {
      device: ready("translation-device-v1"),
      cloud: ready("translation-cloud-v1"),
    },
    tts: { device: ready("tts-device-v1"), cloud: ready("tts-cloud-v1") },
  };
}

interface Call {
  sql: string;
  values?: unknown[];
}
