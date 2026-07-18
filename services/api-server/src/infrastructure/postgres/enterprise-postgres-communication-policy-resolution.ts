import { createHash, randomUUID } from "node:crypto";
import {
  resolveEnterpriseCommunicationPolicy,
  type EnterpriseFeatureReadiness,
} from "../../modules/enterprise/enterprise-communication-policy.js";
import {
  isTerminalEnterpriseCommunicationStatus,
} from "../../modules/enterprise/enterprise-communication-session.js";
import {
  mapEnterpriseCommunicationBindingRow,
  type EnterpriseCommunicationBindingPostgresRow,
} from "./enterprise-postgres-communication-binding-row.js";
import {
  activeAuthorizationPurposes,
  mapEnterpriseCommunicationPolicySnapshot,
  mapEnterpriseCommunicationPolicyVersion,
  type EnterpriseCommunicationAuthorizationRow,
  type EnterpriseCommunicationPolicySnapshotRow,
  type EnterpriseCommunicationPolicyVersionRow,
} from "./enterprise-postgres-communication-policy-record.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export interface ResolveEnterpriseCommunicationPolicyInput {
  communicationSessionId: string;
  authorizationEvidenceIds: string[];
  readiness: {
    asr: EnterpriseFeatureReadiness;
    translation: EnterpriseFeatureReadiness;
    tts: EnterpriseFeatureReadiness;
  };
  now?: Date;
}

export class EnterpriseCommunicationPolicyResolutionPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async currentPublishedVersion() {
    const result = await this.session.query<{ policy_version: string }>(`
      SELECT policy_version FROM enterprise.communication_policy_versions
      WHERE tenant_id = $1 AND status = 'published'
      ORDER BY published_at DESC, id DESC LIMIT 1
    `);
    return result.rows[0]?.policy_version ?? null;
  }

  async resolve(input: ResolveEnterpriseCommunicationPolicyInput) {
    const normalized = normalize(input);
    const bindingResult = await this.session.query<
      EnterpriseCommunicationBindingPostgresRow
    >(`
      SELECT * FROM enterprise.communication_session_bindings
      WHERE tenant_id = $1 AND communication_session_id = $2 FOR UPDATE
    `, [normalized.communicationSessionId]);
    if (!bindingResult.rows[0]) return { status: "not_found" as const };
    const binding = mapEnterpriseCommunicationBindingRow(
      bindingResult.rows[0],
      this.session.context.tenantId,
    );
    if (isTerminalEnterpriseCommunicationStatus(binding.status)) {
      return { status: "terminal" as const };
    }
    const existing = await this.findSnapshot(
      binding.communicationSessionId,
      binding.generation,
    );
    const policyResult = await this.session.query<
      EnterpriseCommunicationPolicyVersionRow
    >(`
      SELECT * FROM enterprise.communication_policy_versions
      WHERE tenant_id = $1 AND policy_version = $2
    `, [binding.policyVersion]);
    if (!policyResult.rows[0]) return { status: "policy_not_found" as const };
    const evidence = normalized.authorizationEvidenceIds.length === 0 ? []
      : (await this.session.query<EnterpriseCommunicationAuthorizationRow>(`
          SELECT id, purpose, expires_at, revoked_at
          FROM enterprise.communication_authorization_evidence
          WHERE tenant_id = $1 AND communication_session_id = $2
            AND id = ANY($3::uuid[]) AND policy_version = $4 FOR UPDATE
        `, [
          binding.communicationSessionId,
          normalized.authorizationEvidenceIds,
          binding.policyVersion,
        ])).rows;
    let authorizedPurposes;
    try {
      authorizedPurposes = activeAuthorizationPurposes(
        evidence,
        normalized.authorizationEvidenceIds,
        normalized.now,
      );
    } catch {
      return { status: "authorization_invalid" as const };
    }
    const resolved = resolveEnterpriseCommunicationPolicy({
      policy: mapEnterpriseCommunicationPolicyVersion(
        policyResult.rows[0],
        this.session.context.tenantId,
      ),
      bindingPolicyVersion: binding.policyVersion,
      readiness: normalized.readiness,
      authorizedPurposes,
      now: normalized.now,
    });
    const requestHash = digest({
      session: binding.communicationSessionId,
      routeEpoch: binding.routeEpoch,
      generation: binding.generation,
      policyVersion: binding.policyVersion,
      authorizationEvidenceIds: normalized.authorizationEvidenceIds,
      readiness: normalized.readiness,
    });
    if (existing) {
      return existing.requestHash === requestHash
        ? { status: "replayed" as const, snapshot: existing }
        : { status: "resolution_conflict" as const };
    }
    const id = randomUUID();
    const inserted = await this.session.query<
      EnterpriseCommunicationPolicySnapshotRow
    >(`
      INSERT INTO enterprise.communication_policy_snapshots(
        tenant_id, id, communication_session_id, policy_version,
        route_epoch, generation, asr_execution, translation_execution,
        tts_execution, voice_identity_enabled, recording_enabled,
        diagnostic_audio_enabled, authorization_evidence_ids,
        allowed_capabilities, runtime_state, reason_code, fingerprints,
        readiness_expires_at, request_hash, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, 'active', $20
      ) RETURNING *
    `, [
      id,
      binding.communicationSessionId,
      binding.policyVersion,
      binding.routeEpoch,
      binding.generation,
      resolved.asrExecution,
      resolved.translationExecution,
      resolved.ttsExecution,
      resolved.voiceIdentityEnabled,
      resolved.recordingEnabled,
      resolved.diagnosticAudioEnabled,
      normalized.authorizationEvidenceIds,
      resolved.allowedCapabilities,
      resolved.runtimeState,
      resolved.reasonCode,
      JSON.stringify(resolved.fingerprints),
      resolved.readinessExpiresAt,
      requestHash,
      normalized.now.toISOString(),
    ]);
    return {
      status: "created" as const,
      snapshot: mapEnterpriseCommunicationPolicySnapshot(
        inserted.rows[0]!,
        this.session.context.tenantId,
      ),
    };
  }

  private async findSnapshot(sessionId: string, generation: number) {
    const result = await this.session.query<EnterpriseCommunicationPolicySnapshotRow>(`
      SELECT * FROM enterprise.communication_policy_snapshots
      WHERE tenant_id = $1 AND communication_session_id = $2
        AND generation = $3 FOR UPDATE
    `, [sessionId, generation]);
    return result.rows[0] ? mapEnterpriseCommunicationPolicySnapshot(
      result.rows[0],
      this.session.context.tenantId,
    ) : null;
  }
}

function normalize(input: ResolveEnterpriseCommunicationPolicyInput) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || !input.communicationSessionId.trim() ||
    Buffer.byteLength(input.communicationSessionId) > 200 ||
    input.authorizationEvidenceIds.length > 3) {
    throw new Error("Invalid enterprise communication policy resolution");
  }
  const authorizationEvidenceIds = [...new Set(
    input.authorizationEvidenceIds,
  )].sort();
  if (authorizationEvidenceIds.length !== input.authorizationEvidenceIds.length ||
    authorizationEvidenceIds.some((id) => !uuid(id))) {
    throw new Error("Invalid enterprise communication authorization ids");
  }
  return { ...input, authorizationEvidenceIds, now };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
