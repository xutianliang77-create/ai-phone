import type {
  EnterpriseAuthorizationPurpose,
  EnterpriseCommunicationPolicyVersion,
} from "../../modules/enterprise/enterprise-communication-policy.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export interface PublishEnterpriseCommunicationPolicyInput
  extends Omit<EnterpriseCommunicationPolicyVersion, "tenantId"> {
  publishedAt: string;
}

export interface RecordEnterpriseCommunicationAuthorizationInput {
  id: string;
  communicationSessionId: string;
  policyVersion: string;
  purpose: EnterpriseAuthorizationPurpose;
  evidenceHash: string;
  subjectSetHash: string;
  grantedAt: string;
  expiresAt?: string;
  createdAt: string;
}

export class EnterpriseCommunicationPolicyWritePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async publish(input: PublishEnterpriseCommunicationPolicyInput) {
    validatePolicy(input);
    const result = await this.session.query<{ id: string }>(`
      INSERT INTO enterprise.communication_policy_versions(
        tenant_id, id, policy_version, status, asr_preference,
        translation_preference, tts_preference, voice_identity_mode,
        recording_mode, diagnostic_audio_mode, allow_captions_only,
        allow_half_duplex, published_at
      ) VALUES (
        $1, $2, $3, 'published', $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) ON CONFLICT (tenant_id, policy_version) DO NOTHING RETURNING id
    `, [
      input.id,
      input.policyVersion,
      input.asrPreference,
      input.translationPreference,
      input.ttsPreference,
      input.voiceIdentityMode,
      input.recordingMode,
      input.diagnosticAudioMode,
      input.allowCaptionsOnly,
      input.allowHalfDuplex,
      input.publishedAt,
    ]);
    return result.rows[0]
      ? { status: "created" as const, id: result.rows[0].id }
      : { status: "version_conflict" as const };
  }

  async recordAuthorization(
    input: RecordEnterpriseCommunicationAuthorizationInput,
  ) {
    validateAuthorization(input);
    const binding = await this.session.query<{ policy_version: string }>(`
      SELECT policy_version FROM enterprise.communication_session_bindings
      WHERE tenant_id = $1 AND communication_session_id = $2 FOR UPDATE
    `, [input.communicationSessionId]);
    if (!binding.rows[0]) return { status: "not_found" as const };
    if (binding.rows[0].policy_version !== input.policyVersion) {
      return { status: "policy_mismatch" as const };
    }
    const inserted = await this.session.query<{ id: string }>(`
      INSERT INTO enterprise.communication_authorization_evidence(
        tenant_id, id, communication_session_id, policy_version, purpose,
        evidence_hash, subject_set_hash, granted_at, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, id) DO NOTHING RETURNING id
    `, [
      input.id,
      input.communicationSessionId,
      input.policyVersion,
      input.purpose,
      input.evidenceHash,
      input.subjectSetHash,
      input.grantedAt,
      input.expiresAt ?? null,
      input.createdAt,
    ]);
    return inserted.rows[0]
      ? { status: "created" as const, id: inserted.rows[0].id }
      : { status: "id_conflict" as const };
  }

  async revokeAuthorization(input: { id: string; revokedAt: string }) {
    uuid(input.id, "authorization id");
    iso(input.revokedAt, "revoked at");
    const current = await this.session.query<{ revoked_at: unknown }>(`
      SELECT revoked_at FROM enterprise.communication_authorization_evidence
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [input.id]);
    if (!current.rows[0]) return { status: "not_found" as const };
    if (current.rows[0].revoked_at) return { status: "revoked" as const };
    const result = await this.session.query<{ id: string }>(`
      UPDATE enterprise.communication_authorization_evidence
      SET revoked_at = $3 WHERE tenant_id = $1 AND id = $2
        AND revoked_at IS NULL RETURNING id
    `, [input.id, input.revokedAt]);
    return result.rows[0]
      ? { status: "revoked" as const, id: result.rows[0].id }
      : { status: "conflict" as const };
  }
}

function validatePolicy(input: PublishEnterpriseCommunicationPolicyInput) {
  uuid(input.id, "policy id");
  bounded(input.policyVersion, 128, "policy version");
  iso(input.publishedAt, "published at");
  const preferences = [
    "device_only", "prefer_device", "prefer_cloud", "cloud_only", "disabled",
  ];
  for (const value of [
    input.asrPreference,
    input.translationPreference,
    input.ttsPreference,
  ]) if (!preferences.includes(value)) throw new Error("Invalid policy preference");
  for (const value of [
    input.voiceIdentityMode,
    input.recordingMode,
    input.diagnosticAudioMode,
  ]) if (!["disabled", "consent_required"].includes(value)) {
    throw new Error("Invalid sensitive feature mode");
  }
}

function validateAuthorization(input: RecordEnterpriseCommunicationAuthorizationInput) {
  uuid(input.id, "authorization id");
  bounded(input.communicationSessionId, 200, "session id");
  bounded(input.policyVersion, 128, "policy version");
  if (!["voice_identity", "recording", "diagnostic_audio"].includes(
    input.purpose,
  )) throw new Error("Invalid authorization purpose");
  hash(input.evidenceHash, "evidence hash");
  hash(input.subjectSetHash, "subject set hash");
  const grantedAt = iso(input.grantedAt, "granted at");
  const createdAt = iso(input.createdAt, "created at");
  const expiresAt = input.expiresAt ? iso(input.expiresAt, "expires at") : null;
  if (createdAt < grantedAt || expiresAt !== null && expiresAt <= grantedAt) {
    throw new Error("Invalid enterprise communication authorization time");
  }
}

function uuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)) throw new Error(`Invalid enterprise communication ${field}`);
}
function bounded(value: string, max: number, field: string) {
  if (!value.trim() || Buffer.byteLength(value) > max) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
}
function hash(value: string, field: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
}
function iso(value: string, field: string) {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
  return result;
}
