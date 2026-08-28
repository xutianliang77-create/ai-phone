import {
  agentWorkSideEffectScopes,
  type AgentWorkCreatePayload,
  type AgentWorkSideEffectScope,
} from "@translation/contracts";
import { AgentWorkValidationError } from "./agent-work-record.js";

export type AgentPermissionRequestStatus =
  | "pending"
  | "granted"
  | "denied"
  | "expired"
  | "cancelled";

export interface AgentPermissionRequestRecord {
  permissionRequestId: string;
  agentRunId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  actorId: string;
  toolName: string;
  toolVersion: string;
  submissionKey: string;
  requestHash: string;
  argumentsHash: string;
  explicitInstructionEvidenceHash: string;
  authorizerEvidenceHash?: string;
  policyVersion: string;
  riskLevel: "low" | "sensitive";
  sideEffectScopes: AgentWorkSideEffectScope[];
  reasonCode: string;
  status: AgentPermissionRequestStatus;
  turnGeneration: number;
  dispatchGeneration: number;
  authorizationSnapshotId?: string;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface AgentTurnAuthorizationRecord {
  authorizationSnapshotId: string;
  permissionRequestId: string;
  agentRunId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  actorId: string;
  toolName: string;
  toolVersion: string;
  argumentsHash: string;
  explicitInstructionEvidenceHash: string;
  authorizerEvidenceHash: string;
  policyVersion: string;
  riskLevel: "low" | "sensitive";
  sideEffectScopes: AgentWorkSideEffectScope[];
  turnGeneration: number;
  dispatchGeneration: number;
  status: "active" | "revoked" | "expired";
  requestHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
}

export interface AgentPermissionRequestInput {
  permissionRequestId: string;
  agentRunId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  actorId: string;
  commandId: string;
  sealedArguments: string;
  toolName: string;
  toolVersion: string;
  submissionKey: string;
  argumentsHash: string;
  explicitInstructionEvidenceHash: string;
  policyVersion: string;
  riskLevel: "low" | "sensitive";
  sideEffectScopes: AgentWorkSideEffectScope[];
  reasonCode: string;
  turnGeneration: number;
  dispatchGeneration: number;
  expiresAt: string;
  now?: Date;
}

export type AgentPermissionRequestRow = Record<string, unknown> & {
  permission_request_id: string;
  sealed_arguments: string;
};

export type AgentTurnAuthorizationRow = Record<string, unknown> & {
  authorization_snapshot_id: string;
};

export function normalizePermissionRequest(input: AgentPermissionRequestInput) {
  const now = validDate(input.now ?? new Date(), "permission_now");
  const expiresAt = validDate(new Date(input.expiresAt), "permission_expires_at");
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AgentWorkValidationError("permission_expiry_not_future");
  }
  return {
    permissionRequestId: text(input.permissionRequestId, "permission_request_id"),
    agentRunId: text(input.agentRunId, "agent_run_id"),
    sessionId: text(input.sessionId, "session_id"),
    legId: text(input.legId, "leg_id"),
    turnId: text(input.turnId, "turn_id"),
    actorId: text(input.actorId, "actor_id"),
    commandId: text(input.commandId, "command_id", 200),
    sealedArguments: text(input.sealedArguments, "sealed_arguments", 65_536),
    toolName: text(input.toolName, "tool_name", 120),
    toolVersion: text(input.toolVersion, "tool_version", 80),
    submissionKey: text(input.submissionKey, "submission_key", 240),
    argumentsHash: hash(input.argumentsHash, "arguments_hash"),
    explicitInstructionEvidenceHash: hash(
      input.explicitInstructionEvidenceHash,
      "explicit_instruction_evidence_hash",
    ),
    policyVersion: text(input.policyVersion, "policy_version"),
    riskLevel: risk(input.riskLevel),
    sideEffectScopes: scopes(input.sideEffectScopes),
    reasonCode: text(input.reasonCode, "reason_code", 120),
    turnGeneration: integer(input.turnGeneration, "turn_generation"),
    dispatchGeneration:
      integer(input.dispatchGeneration, "dispatch_generation"),
    expiresAt,
    now,
  };
}

export function permissionRequestFromRow(
  row: AgentPermissionRequestRow,
): AgentPermissionRequestRecord {
  return {
    permissionRequestId: text(row.permission_request_id, "permission_request_id"),
    agentRunId: text(row.agent_run_id, "agent_run_id"),
    sessionId: text(row.session_id, "session_id"),
    legId: text(row.leg_id, "leg_id"),
    turnId: text(row.turn_id, "turn_id"),
    actorId: text(row.actor_id, "actor_id"),
    toolName: text(row.tool_name, "tool_name", 120),
    toolVersion: text(row.tool_version, "tool_version", 80),
    submissionKey: text(row.submission_key, "submission_key", 240),
    requestHash: hash(row.request_hash, "request_hash"),
    argumentsHash: hash(row.arguments_hash, "arguments_hash"),
    explicitInstructionEvidenceHash:
      hash(row.explicit_instruction_evidence_hash,
        "explicit_instruction_evidence_hash"),
    ...(row.authorizer_evidence_hash
      ? { authorizerEvidenceHash: hash(row.authorizer_evidence_hash,
        "authorizer_evidence_hash") }
      : {}),
    policyVersion: text(row.policy_version, "policy_version"),
    riskLevel: risk(row.risk_level),
    sideEffectScopes: scopes(row.side_effect_scopes),
    reasonCode: text(row.reason_code, "reason_code", 120),
    status: requestStatus(row.status),
    turnGeneration: integer(row.turn_generation, "turn_generation"),
    dispatchGeneration:
      integer(row.dispatch_generation, "dispatch_generation"),
    ...(row.authorization_snapshot_id
      ? { authorizationSnapshotId: text(row.authorization_snapshot_id,
        "authorization_snapshot_id") }
      : {}),
    expiresAt: timestamp(row.expires_at, "expires_at"),
    version: integer(row.version, "version"),
    createdAt: timestamp(row.created_at, "created_at"),
    updatedAt: timestamp(row.updated_at, "updated_at"),
    ...(row.resolved_at
      ? { resolvedAt: timestamp(row.resolved_at, "resolved_at") }
      : {}),
  };
}

export function turnAuthorizationFromRow(
  row: AgentTurnAuthorizationRow,
): AgentTurnAuthorizationRecord {
  const status = String(row.status);
  if (!(["active", "revoked", "expired"] as const).includes(status as never)) {
    throw new AgentWorkValidationError("authorization_status_invalid");
  }
  return {
    authorizationSnapshotId:
      text(row.authorization_snapshot_id, "authorization_snapshot_id"),
    permissionRequestId:
      text(row.permission_request_id, "permission_request_id"),
    agentRunId: text(row.agent_run_id, "agent_run_id"),
    sessionId: text(row.session_id, "session_id"),
    legId: text(row.leg_id, "leg_id"),
    turnId: text(row.turn_id, "turn_id"),
    actorId: text(row.actor_id, "actor_id"),
    toolName: text(row.tool_name, "tool_name", 120),
    toolVersion: text(row.tool_version, "tool_version", 80),
    argumentsHash: hash(row.arguments_hash, "arguments_hash"),
    explicitInstructionEvidenceHash:
      hash(row.explicit_instruction_evidence_hash,
        "explicit_instruction_evidence_hash"),
    authorizerEvidenceHash:
      hash(row.authorizer_evidence_hash, "authorizer_evidence_hash"),
    policyVersion: text(row.policy_version, "policy_version"),
    riskLevel: risk(row.risk_level),
    sideEffectScopes: scopes(row.side_effect_scopes),
    turnGeneration: integer(row.turn_generation, "turn_generation"),
    dispatchGeneration:
      integer(row.dispatch_generation, "dispatch_generation"),
    status: status as AgentTurnAuthorizationRecord["status"],
    requestHash: hash(row.request_hash, "request_hash"),
    expiresAt: timestamp(row.expires_at, "expires_at"),
    createdAt: timestamp(row.created_at, "created_at"),
    ...(row.revoked_at
      ? { revokedAt: timestamp(row.revoked_at, "revoked_at") }
      : {}),
  };
}

export function assertWorkAuthorization(
  authorization: AgentTurnAuthorizationRecord,
  input: {
    agentRunId: string;
    sessionId: string;
    legId: string;
    turnId: string;
    actorId: string;
    payload: AgentWorkCreatePayload;
    now?: Date;
  },
) {
  const now = validDate(input.now ?? new Date(), "authorization_now");
  const payload = input.payload;
  const mismatch = authorization.status !== "active" ||
    Date.parse(authorization.expiresAt) <= now.getTime() ||
    Date.parse(payload.expiresAt) > Date.parse(authorization.expiresAt) ||
    authorization.authorizationSnapshotId !== payload.consentSnapshotId ||
    authorization.agentRunId !== input.agentRunId ||
    authorization.sessionId !== input.sessionId ||
    authorization.legId !== input.legId ||
    authorization.turnId !== input.turnId ||
    authorization.actorId !== input.actorId ||
    authorization.toolName !== payload.toolName ||
    authorization.toolVersion !== payload.toolVersion ||
    authorization.argumentsHash !== payload.argumentsHash ||
    authorization.explicitInstructionEvidenceHash !==
      payload.explicitInstructionEvidenceHash ||
    authorization.policyVersion !== payload.policyVersion ||
    authorization.riskLevel !== payload.riskLevel ||
    authorization.turnGeneration !== payload.turnGeneration ||
    authorization.dispatchGeneration !== payload.dispatchGeneration ||
    JSON.stringify([...authorization.sideEffectScopes].sort()) !==
      JSON.stringify([...payload.sideEffectScopes].sort());
  if (mismatch) {
    throw new AgentWorkPermissionConflict("authorization_binding_mismatch");
  }
}

export class AgentWorkPermissionConflict extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentWorkPermissionConflict";
  }
}

function requestStatus(value: unknown): AgentPermissionRequestStatus {
  const status = String(value);
  if (!["pending", "granted", "denied", "expired", "cancelled"]
    .includes(status)) {
    throw new AgentWorkValidationError("permission_status_invalid");
  }
  return status as AgentPermissionRequestStatus;
}

function scopes(value: unknown): AgentWorkSideEffectScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new AgentWorkValidationError("permission_scopes_invalid");
  }
  const parsed = value.map((item) => String(item));
  if (new Set(parsed).size !== parsed.length ||
    !parsed.every((item) => (agentWorkSideEffectScopes as readonly string[])
      .includes(item)) || (parsed.includes("none") && parsed.length !== 1)) {
    throw new AgentWorkValidationError("permission_scopes_invalid");
  }
  return parsed as AgentWorkSideEffectScope[];
}

function risk(value: unknown) {
  if (value !== "low" && value !== "sensitive") {
    throw new AgentWorkValidationError("permission_risk_invalid");
  }
  return value;
}

function text(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim() ||
      Buffer.byteLength(value) > maximum) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value.trim();
}

function hash(value: unknown, name: string) {
  const result = text(value, name, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return result;
}

function integer(value: unknown, name: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return result;
}

function timestamp(value: unknown, name: string) {
  const result = text(value, name);
  return validDate(new Date(result), name).toISOString();
}

function validDate(value: Date, name: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value;
}
