import type {
  EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import {
  activeAuthorizationPurposes,
  mapEnterpriseCommunicationPolicySnapshot,
  type EnterpriseCommunicationAuthorizationRow,
  type EnterpriseCommunicationPolicySnapshotRecord,
  type EnterpriseCommunicationPolicySnapshotRow,
} from "./enterprise-postgres-communication-policy-record.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import type {
  EnterpriseWorkerDispatchGrantRecord,
} from "./enterprise-postgres-worker-dispatch-record.js";

export type EnterpriseWorkerPolicyRejectStatus =
  "policy_invalid" | "policy_expired" | "authorization_invalid";

export async function evaluateEnterpriseWorkerPolicyFence(input: {
  session: EnterpriseTenantPostgresSession;
  grant: EnterpriseWorkerDispatchGrantRecord;
  payload: EnterpriseWorkerDispatchTicketPayload;
  now: Date;
}): Promise<
  { policy: EnterpriseCommunicationPolicySnapshotRecord }
  | { rejected: EnterpriseWorkerPolicyRejectStatus }
> {
  const result = await input.session.query<EnterpriseCommunicationPolicySnapshotRow>(`
    SELECT * FROM enterprise.communication_policy_snapshots
    WHERE tenant_id = $1 AND id = $2 AND communication_session_id = $3
      AND generation = $4 AND policy_version = $5 FOR UPDATE
  `, [
    input.payload.policySnapshotId,
    input.payload.communicationSessionId,
    input.payload.generation,
    input.payload.policyVersion,
  ]);
  if (!result.rows[0]) return { rejected: "policy_invalid" };
  const policy = mapEnterpriseCommunicationPolicySnapshot(
    result.rows[0],
    input.session.context.tenantId,
  );
  if (policy.status !== "active" || policy.id !== input.grant.policySnapshotId ||
    policy.routeEpoch !== input.payload.routeEpoch ||
    !policy.allowedCapabilities.includes(input.payload.capability)) {
    return { rejected: "policy_invalid" };
  }
  if (Date.parse(policy.readinessExpiresAt) <= input.now.getTime()) {
    return { rejected: "policy_expired" };
  }
  if (policy.authorizationEvidenceIds.length === 0) {
    return policy.voiceIdentityEnabled || policy.recordingEnabled ||
        policy.diagnosticAudioEnabled
      ? { rejected: "authorization_invalid" }
      : { policy };
  }
  const evidence = await input.session.query<
    EnterpriseCommunicationAuthorizationRow
  >(`
    SELECT id, purpose, expires_at, revoked_at
    FROM enterprise.communication_authorization_evidence
    WHERE tenant_id = $1 AND communication_session_id = $2
      AND id = ANY($3::uuid[]) AND policy_version = $4 FOR UPDATE
  `, [
    input.payload.communicationSessionId,
    policy.authorizationEvidenceIds,
    input.payload.policyVersion,
  ]);
  try {
    const purposes = activeAuthorizationPurposes(
      evidence.rows,
      policy.authorizationEvidenceIds,
      input.now,
    );
    if (policy.voiceIdentityEnabled && !purposes.has("voice_identity") ||
      policy.recordingEnabled && !purposes.has("recording") ||
      policy.diagnosticAudioEnabled && !purposes.has("diagnostic_audio")) {
      return { rejected: "authorization_invalid" };
    }
  } catch {
    return { rejected: "authorization_invalid" };
  }
  return { policy };
}
