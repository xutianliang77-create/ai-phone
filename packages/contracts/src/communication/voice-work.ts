export const agentWorkStatuses = [
  "queued",
  "running",
  "delegated",
  "finalizing",
  "cancelling",
  "completed",
  "cancelled",
  "failed",
] as const;

export type AgentWorkStatus = typeof agentWorkStatuses[number];
export type AgentWorkPriority = "normal" | "permission";
export type AgentWorkRiskLevel = "low" | "sensitive";

export const agentWorkSideEffectScopes = [
  "none",
  "memory_read",
  "memory_write",
  "permission_request",
  "external_read",
  "external_write",
] as const;

export type AgentWorkSideEffectScope =
  typeof agentWorkSideEffectScopes[number];

export interface AgentWorkScopeDto {
  sessionId: string;
  legId: string;
  turnId: string;
  turnGeneration: number;
  dispatchGeneration: number;
}

export interface AgentWorkCreatePayload {
  toolName: string;
  toolVersion: string;
  submissionKey: string;
  argumentsHash: string;
  consentSnapshotId: string;
  explicitInstructionEvidenceHash: string;
  policyVersion: string;
  riskLevel: AgentWorkRiskLevel;
  sideEffectScopes: AgentWorkSideEffectScope[];
  priority: AgentWorkPriority;
  turnGeneration: number;
  dispatchGeneration: number;
  maxAttempts: number;
  maxRuntimeMs: number;
  expiresAt: string;
}

export interface AgentWorkCancelPayload {
  reason: "user_cancelled" | "turn_invalidated" | "session_ending";
  turnGeneration: number;
  dispatchGeneration: number;
}

export type AgentVoiceTurnEventType =
  "user_speaking" | "final_transcript" | "session_ending";

export interface AgentVoiceTurnScopeDto {
  sessionId: string;
  legId: string;
  actorId: string;
  agentRunId: string;
  turnId: string;
  turnGeneration: number;
  dispatchGeneration: number;
  state: "active" | "invalidated" | "session_ending";
  explicitInstructionEvidenceHash?: string;
  observedAt: string;
}

export interface VoiceAgentTurnEventRequest {
  ticket: string;
  eventId: string;
  eventType: AgentVoiceTurnEventType;
  observedAt: string;
  explicitInstructionEvidenceHash?: string;
}

export interface VoiceAgentTurnEventResponse {
  replayed: boolean;
  scope: AgentVoiceTurnScopeDto;
}

export interface VoiceAgentPermissionRequest {
  ticket: string;
  permissionRequestId: string;
  commandId: string;
  turnId: string;
  turnGeneration: number;
  dispatchGeneration: number;
  explicitInstructionEvidenceHash: string;
  toolName: string;
  toolVersion: string;
  submissionKey: string;
  arguments: Record<string, unknown>;
  argumentsHash: string;
  reasonCode: string;
  expiresAt: string;
}

export interface VoiceAgentPermissionRequestDto {
  permissionRequestId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  actorId: string;
  toolName: string;
  toolVersion: string;
  argumentsHash: string;
  explicitInstructionEvidenceHash: string;
  policyVersion: string;
  riskLevel: AgentWorkRiskLevel;
  sideEffectScopes: AgentWorkSideEffectScope[];
  status: "pending" | "granted" | "denied" | "expired" | "cancelled";
  turnGeneration: number;
  dispatchGeneration: number;
  authorizationSnapshotId?: string;
  expiresAt: string;
}

export interface ResolveVoiceAgentPermissionRequest {
  decision: "grant" | "deny";
  commandId: string;
  clientInstanceId: string;
  participantIdentity: string;
  ownershipLeaseId: string;
  ownershipGeneration: number;
  confirmedAt: string;
  turnGeneration: number;
  dispatchGeneration: number;
}

export interface VoiceAgentWorkRequest {
  ticket: string;
  workId: string;
  commandId: string;
  turnId: string;
  permissionRequestId: string;
  authorizationSnapshotId: string;
}

export interface VoiceAgentWorkCancelRequest {
  ticket: string;
  commandId: string;
  payload: AgentWorkCancelPayload;
}

export interface VoiceAgentWorkResponse {
  replayed: boolean;
  work: AgentWorkDto;
}

export interface AgentWorkDto extends AgentWorkScopeDto {
  workId: string;
  agentRunId: string;
  actorId: string;
  toolName: string;
  toolVersion: string;
  submissionKey: string;
  argumentsHash: string;
  consentSnapshotId: string;
  explicitInstructionEvidenceHash: string;
  policyVersion: string;
  riskLevel: AgentWorkRiskLevel;
  sideEffectScopes: AgentWorkSideEffectScope[];
  priority: AgentWorkPriority;
  status: AgentWorkStatus;
  attempt: number;
  maxAttempts: number;
  maxRuntimeMs: number;
  createdAt: string;
  expiresAt: string;
  startedAt?: string;
  endedAt?: string;
  failureCode?: string;
}

export type AgentWorkInvalidationReason =
  | "session_mismatch"
  | "leg_mismatch"
  | "turn_mismatch"
  | "stale_turn_generation"
  | "stale_dispatch_generation";

export function agentWorkInvalidationReason(
  work: AgentWorkScopeDto,
  current: AgentWorkScopeDto,
): AgentWorkInvalidationReason | undefined {
  if (work.sessionId !== current.sessionId) return "session_mismatch";
  if (work.legId !== current.legId) return "leg_mismatch";
  if (work.turnId !== current.turnId) return "turn_mismatch";
  if (work.turnGeneration !== current.turnGeneration) {
    return "stale_turn_generation";
  }
  if (work.dispatchGeneration !== current.dispatchGeneration) {
    return "stale_dispatch_generation";
  }
  return undefined;
}

export function isAgentWorkScopeCurrent(
  work: AgentWorkScopeDto,
  current: AgentWorkScopeDto,
) {
  return agentWorkInvalidationReason(work, current) === undefined;
}

export function parseAgentWorkCreatePayload(
  value: unknown,
): AgentWorkCreatePayload {
  const input = object(value, "Agent Work create payload");
  const priority = input.priority;
  if (priority !== "normal" && priority !== "permission") {
    throw new TypeError("Invalid Agent Work priority");
  }
  return {
    toolName: text(input.toolName, "toolName"),
    toolVersion: text(input.toolVersion, "toolVersion"),
    submissionKey: text(input.submissionKey, "submissionKey", 240),
    argumentsHash: sha256(input.argumentsHash, "argumentsHash"),
    consentSnapshotId: text(input.consentSnapshotId, "consentSnapshotId"),
    explicitInstructionEvidenceHash: sha256(
      input.explicitInstructionEvidenceHash,
      "explicitInstructionEvidenceHash",
    ),
    policyVersion: text(input.policyVersion, "policyVersion"),
    riskLevel: riskLevel(input.riskLevel),
    sideEffectScopes: sideEffectScopes(input.sideEffectScopes),
    priority,
    turnGeneration: positiveInteger(input.turnGeneration, "turnGeneration"),
    dispatchGeneration:
      positiveInteger(input.dispatchGeneration, "dispatchGeneration"),
    maxAttempts: boundedInteger(input.maxAttempts, "maxAttempts", 1, 5),
    maxRuntimeMs: boundedInteger(
      input.maxRuntimeMs,
      "maxRuntimeMs",
      1_000,
      30 * 60_000,
    ),
    expiresAt: timestamp(input.expiresAt, "expiresAt"),
  };
}

function riskLevel(value: unknown): AgentWorkRiskLevel {
  if (value !== "low" && value !== "sensitive") {
    throw new TypeError("Invalid Agent Work riskLevel");
  }
  return value;
}

function sideEffectScopes(value: unknown): AgentWorkSideEffectScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new TypeError("Invalid Agent Work sideEffectScopes");
  }
  const scopes = value.map((item) => {
    if (!agentWorkSideEffectScopes.includes(
      item as AgentWorkSideEffectScope,
    )) {
      throw new TypeError("Invalid Agent Work sideEffectScopes");
    }
    return item as AgentWorkSideEffectScope;
  });
  if (new Set(scopes).size !== scopes.length ||
      (scopes.includes("none") && scopes.length !== 1)) {
    throw new TypeError("Invalid Agent Work sideEffectScopes");
  }
  return scopes;
}

export function parseAgentWorkCancelPayload(
  value: unknown,
): AgentWorkCancelPayload {
  const input = object(value, "Agent Work cancel payload");
  const reason = input.reason;
  if (reason !== "user_cancelled" && reason !== "turn_invalidated" &&
      reason !== "session_ending") {
    throw new TypeError("Invalid Agent Work cancellation reason");
  }
  return {
    reason,
    turnGeneration: positiveInteger(input.turnGeneration, "turnGeneration"),
    dispatchGeneration:
      positiveInteger(input.dispatchGeneration, "dispatchGeneration"),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || value.trim().length === 0 ||
      Buffer.byteLength(value) > maximum) {
    throw new TypeError(`Invalid Agent Work ${name}`);
  }
  return value.trim();
}

function sha256(value: unknown, name: string) {
  const result = text(value, name, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new TypeError(`Invalid Agent Work ${name}`);
  }
  return result;
}

function positiveInteger(value: unknown, name: string) {
  return boundedInteger(value, name, 1, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum ||
      Number(value) > maximum) {
    throw new TypeError(`Invalid Agent Work ${name}`);
  }
  return Number(value);
}

function timestamp(value: unknown, name: string) {
  const result = text(value, name, 64);
  if (Number.isNaN(Date.parse(result))) {
    throw new TypeError(`Invalid Agent Work ${name}`);
  }
  return result;
}
