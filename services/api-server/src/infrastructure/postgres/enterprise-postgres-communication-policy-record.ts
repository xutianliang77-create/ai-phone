import {
  enterpriseExecutionPreferences,
  enterpriseSensitiveFeatureModes,
  type EnterpriseAuthorizationPurpose,
  type EnterpriseCommunicationPolicyVersion,
  type EnterpriseExecutionTarget,
  type EnterpriseResolvedCommunicationPolicy,
} from "../../modules/enterprise/enterprise-communication-policy.js";
import type {
  EnterpriseWorkerCapability,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";

export interface EnterpriseCommunicationPolicyVersionRow
  extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  policy_version: unknown;
  asr_preference: unknown;
  translation_preference: unknown;
  tts_preference: unknown;
  voice_identity_mode: unknown;
  recording_mode: unknown;
  diagnostic_audio_mode: unknown;
  allow_captions_only: unknown;
  allow_half_duplex: unknown;
}

export interface EnterpriseCommunicationPolicySnapshotRecord
  extends EnterpriseResolvedCommunicationPolicy {
  id: string;
  tenantId: string;
  communicationSessionId: string;
  routeEpoch: number;
  generation: number;
  authorizationEvidenceIds: string[];
  requestHash: string;
  status: "active" | "invalidated";
  createdAt: string;
  invalidatedAt?: string;
}

export interface EnterpriseCommunicationPolicySnapshotRow
  extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  communication_session_id: unknown;
  policy_version: unknown;
  route_epoch: unknown;
  generation: unknown;
  asr_execution: unknown;
  translation_execution: unknown;
  tts_execution: unknown;
  voice_identity_enabled: unknown;
  recording_enabled: unknown;
  diagnostic_audio_enabled: unknown;
  authorization_evidence_ids: unknown;
  allowed_capabilities: unknown;
  runtime_state: unknown;
  reason_code: unknown;
  fingerprints: unknown;
  readiness_expires_at: unknown;
  request_hash: unknown;
  status: unknown;
  created_at: unknown;
  invalidated_at: unknown;
}

export interface EnterpriseCommunicationAuthorizationRow
  extends Record<string, unknown> {
  id: unknown;
  purpose: unknown;
  expires_at: unknown;
  revoked_at: unknown;
}

export function mapEnterpriseCommunicationPolicyVersion(
  row: EnterpriseCommunicationPolicyVersionRow,
  tenantId: string,
): EnterpriseCommunicationPolicyVersion {
  assertTenant(row.tenant_id, tenantId);
  const asrPreference = oneOf(row.asr_preference, enterpriseExecutionPreferences);
  const translationPreference = oneOf(
    row.translation_preference,
    enterpriseExecutionPreferences,
  );
  const ttsPreference = oneOf(row.tts_preference, enterpriseExecutionPreferences);
  const voiceIdentityMode = oneOf(
    row.voice_identity_mode,
    enterpriseSensitiveFeatureModes,
  );
  const recordingMode = oneOf(row.recording_mode, enterpriseSensitiveFeatureModes);
  const diagnosticAudioMode = oneOf(
    row.diagnostic_audio_mode,
    enterpriseSensitiveFeatureModes,
  );
  return {
    id: text(row.id),
    tenantId,
    policyVersion: text(row.policy_version),
    asrPreference,
    translationPreference,
    ttsPreference,
    voiceIdentityMode,
    recordingMode,
    diagnosticAudioMode,
    allowCaptionsOnly: bool(row.allow_captions_only),
    allowHalfDuplex: bool(row.allow_half_duplex),
  };
}

export function mapEnterpriseCommunicationPolicySnapshot(
  row: EnterpriseCommunicationPolicySnapshotRow,
  tenantId: string,
): EnterpriseCommunicationPolicySnapshotRecord {
  assertTenant(row.tenant_id, tenantId);
  const status = oneOf(row.status, ["active", "invalidated"] as const);
  const invalidatedAt = optionalTime(row.invalidated_at);
  if ((status === "active") === Boolean(invalidatedAt)) {
    throw new Error("Invalid enterprise communication policy snapshot status");
  }
  return {
    id: text(row.id),
    tenantId,
    communicationSessionId: text(row.communication_session_id),
    policyVersion: text(row.policy_version),
    routeEpoch: positive(row.route_epoch),
    generation: positive(row.generation),
    asrExecution: execution(row.asr_execution),
    translationExecution: execution(row.translation_execution),
    ttsExecution: execution(row.tts_execution),
    voiceIdentityEnabled: bool(row.voice_identity_enabled),
    recordingEnabled: bool(row.recording_enabled),
    diagnosticAudioEnabled: bool(row.diagnostic_audio_enabled),
    authorizationEvidenceIds: strings(row.authorization_evidence_ids),
    allowedCapabilities: capabilities(row.allowed_capabilities),
    runtimeState: oneOf(
      row.runtime_state,
      ["full", "captions_only", "half_duplex", "blocked"] as const,
    ),
    reasonCode: text(row.reason_code),
    fingerprints: object(row.fingerprints),
    readinessExpiresAt: time(row.readiness_expires_at),
    requestHash: hash(row.request_hash),
    status,
    createdAt: time(row.created_at),
    ...(invalidatedAt ? { invalidatedAt } : {}),
  };
}

export function activeAuthorizationPurposes(
  rows: EnterpriseCommunicationAuthorizationRow[],
  expectedIds: string[],
  now: Date,
) {
  const byId = new Map(rows.map((row) => [text(row.id), row]));
  const purposes = new Set<EnterpriseAuthorizationPurpose>();
  for (const id of expectedIds) {
    const row = byId.get(id);
    if (!row || row.revoked_at !== null && row.revoked_at !== undefined) {
      throw new Error("Enterprise communication authorization is not active");
    }
    const expiresAt = optionalTime(row.expires_at);
    if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
      throw new Error("Enterprise communication authorization is expired");
    }
    purposes.add(oneOf(
      row.purpose,
      ["voice_identity", "recording", "diagnostic_audio"] as const,
    ));
  }
  if (byId.size !== expectedIds.length) {
    throw new Error("Enterprise communication authorization set mismatch");
  }
  return purposes;
}

function execution(value: unknown): EnterpriseExecutionTarget {
  return oneOf(
    value,
    ["device", "cloud", "disabled", "unavailable"] as const,
  );
}
function capabilities(value: unknown) {
  return strings(value).map((item) => oneOf(
    item,
    ["translation_runtime", "voice_agent_runtime"] as const,
  )) as EnterpriseWorkerCapability[];
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid enterprise communication policy array");
  }
  return [...new Set(value)];
}
function object(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "string")) {
    throw new Error("Invalid enterprise communication policy fingerprints");
  }
  return value as Record<string, string>;
}
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value as T[number])) {
    throw new Error("Invalid enterprise communication policy value");
  }
  return value as T[number];
}
function assertTenant(value: unknown, tenantId: string) {
  if (value !== tenantId) throw new Error("Enterprise communication policy tenant mismatch");
}
function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid enterprise communication policy text");
  }
  return value.trim();
}
function bool(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Invalid enterprise communication policy boolean");
  }
  return value;
}
function positive(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Invalid enterprise communication policy integer");
  }
  return number;
}
function hash(value: unknown) {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error("Invalid enterprise communication policy hash");
  }
  return result;
}
function time(value: unknown) {
  const result = value instanceof Date ? value.toISOString() : text(value);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error("Invalid enterprise communication policy timestamp");
  }
  return result;
}
function optionalTime(value: unknown) {
  return value === null || value === undefined ? undefined : time(value);
}
