import {
  agentWorkSideEffectScopes,
  agentWorkStatuses,
  parseAgentWorkCreatePayload,
  type AgentWorkCreatePayload,
  type AgentWorkDto,
  type AgentWorkSideEffectScope,
  type AgentWorkStatus,
} from "@translation/contracts";

export interface AgentWorkClaim {
  claimId: string;
  owner: string;
  expiresAt: string;
}

export interface AgentWorkRecord extends AgentWorkDto {
  explicitInstructionEvidenceHash: string;
  riskLevel: "low" | "sensitive";
  sideEffectScopes: AgentWorkSideEffectScope[];
  requestHash: string;
  version: number;
  availableAt: string;
  updatedAt: string;
  claim?: AgentWorkClaim;
  cancellationReason?: string;
  cancelRequestedAt?: string;
  cancelDeadlineAt?: string;
  resultSummary?: unknown;
  lastErrorCode?: string;
}

export interface AgentWorkCreateInput {
  workId: string;
  agentRunId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  actorId: string;
  commandId: string;
  sealedArguments: string;
  payload: AgentWorkCreatePayload;
  now?: Date;
}

export interface AgentWorkRow {
  work_id: string;
  agent_run_id: string;
  session_id: string;
  leg_id: string;
  turn_id: string;
  actor_id: string;
  tool_name: string;
  tool_version: string;
  submission_key: string;
  request_hash: string;
  arguments_hash: string;
  sealed_arguments: string;
  consent_snapshot_id: string;
  explicit_instruction_evidence_hash: string;
  policy_version: string;
  risk_level: string;
  side_effect_scopes: unknown;
  priority: string;
  status: string;
  turn_generation: string | number;
  dispatch_generation: string | number;
  attempt: number;
  max_attempts: number;
  max_runtime_ms: number;
  available_at: Date | string;
  expires_at: Date | string;
  claim_id: string | null;
  claim_owner: string | null;
  claim_expires_at: Date | string | null;
  cancellation_reason: string | null;
  cancel_requested_at: Date | string | null;
  cancel_deadline_at: Date | string | null;
  result_summary: unknown;
  last_error_code: string | null;
  failure_code: string | null;
  version: string | number;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  ended_at: Date | string | null;
}

export function normalizeAgentWorkCreateInput(input: AgentWorkCreateInput) {
  const payload = parseAgentWorkCreatePayload(input.payload);
  const now = validDate(input.now ?? new Date(), "now");
  const expiresAt = validDate(new Date(payload.expiresAt), "expiresAt");
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AgentWorkValidationError("work_expiry_not_future");
  }
  return {
    workId: bounded(input.workId, "workId", 160),
    agentRunId: bounded(input.agentRunId, "agentRunId", 160),
    sessionId: bounded(input.sessionId, "sessionId", 160),
    legId: bounded(input.legId, "legId", 160),
    turnId: bounded(input.turnId, "turnId", 160),
    actorId: bounded(input.actorId, "actorId", 160),
    commandId: bounded(input.commandId, "commandId", 200),
    sealedArguments:
      bounded(input.sealedArguments, "sealedArguments", 65_536),
    payload,
    now,
    expiresAt,
  };
}

export function agentWorkFromRow(row: AgentWorkRow): AgentWorkRecord {
  const status = enumValue(row.status, agentWorkStatuses, "status");
  const priority = enumValue(row.priority, ["normal", "permission"] as const,
    "priority");
  const riskLevel = enumValue(row.risk_level, ["low", "sensitive"] as const,
    "riskLevel");
  const sideEffectScopes = parseScopes(row.side_effect_scopes);
  const claim = claimFromRow(row);
  return {
    workId: bounded(row.work_id, "workId", 160),
    agentRunId: bounded(row.agent_run_id, "agentRunId", 160),
    sessionId: bounded(row.session_id, "sessionId", 160),
    legId: bounded(row.leg_id, "legId", 160),
    turnId: bounded(row.turn_id, "turnId", 160),
    actorId: bounded(row.actor_id, "actorId", 160),
    toolName: bounded(row.tool_name, "toolName", 120),
    toolVersion: bounded(row.tool_version, "toolVersion", 80),
    submissionKey: bounded(row.submission_key, "submissionKey", 240),
    requestHash: hash(row.request_hash, "requestHash"),
    argumentsHash: hash(row.arguments_hash, "argumentsHash"),
    consentSnapshotId:
      bounded(row.consent_snapshot_id, "consentSnapshotId", 160),
    explicitInstructionEvidenceHash: hash(
      row.explicit_instruction_evidence_hash,
      "explicitInstructionEvidenceHash",
    ),
    policyVersion: bounded(row.policy_version, "policyVersion", 160),
    riskLevel,
    sideEffectScopes,
    priority,
    status,
    turnGeneration: integer(row.turn_generation, "turnGeneration", 1),
    dispatchGeneration:
      integer(row.dispatch_generation, "dispatchGeneration", 1),
    attempt: integer(row.attempt, "attempt", 0),
    maxAttempts: integer(row.max_attempts, "maxAttempts", 1, 5),
    maxRuntimeMs:
      integer(row.max_runtime_ms, "maxRuntimeMs", 1_000, 1_800_000),
    version: integer(row.version, "version", 1),
    availableAt: iso(row.available_at, "availableAt"),
    expiresAt: iso(row.expires_at, "expiresAt"),
    createdAt: iso(row.created_at, "createdAt"),
    updatedAt: iso(row.updated_at, "updatedAt"),
    ...(claim ? { claim } : {}),
    ...(row.cancellation_reason
      ? { cancellationReason: row.cancellation_reason }
      : {}),
    ...(row.cancel_requested_at
      ? { cancelRequestedAt: iso(row.cancel_requested_at, "cancelRequestedAt") }
      : {}),
    ...(row.cancel_deadline_at
      ? { cancelDeadlineAt: iso(row.cancel_deadline_at, "cancelDeadlineAt") }
      : {}),
    ...(row.result_summary !== null
      ? { resultSummary: row.result_summary }
      : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.started_at ? { startedAt: iso(row.started_at, "startedAt") } : {}),
    ...(row.ended_at ? { endedAt: iso(row.ended_at, "endedAt") } : {}),
  };
}

export function canTransitionAgentWork(
  current: AgentWorkStatus,
  next: AgentWorkStatus,
) {
  if (next === "failed") return !isTerminalAgentWork(current);
  const allowed: Partial<Record<AgentWorkStatus, AgentWorkStatus[]>> = {
    running: ["delegated", "finalizing", "cancelling"],
    delegated: ["finalizing", "cancelling"],
    finalizing: ["completed", "cancelling"],
    cancelling: ["cancelled"],
  };
  return allowed[current]?.includes(next) ?? false;
}

export function isTerminalAgentWork(status: AgentWorkStatus) {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export class AgentWorkValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentWorkValidationError";
  }
}

function claimFromRow(row: AgentWorkRow): AgentWorkClaim | undefined {
  const present = [row.claim_id, row.claim_owner, row.claim_expires_at]
    .filter((item) => item !== null).length;
  if (present === 0) return undefined;
  if (present !== 3) throw new AgentWorkValidationError("claim_binding_invalid");
  return {
    claimId: bounded(row.claim_id!, "claimId", 200),
    owner: bounded(row.claim_owner!, "claimOwner", 200),
    expiresAt: iso(row.claim_expires_at!, "claimExpiresAt"),
  };
}

function parseScopes(value: unknown): AgentWorkSideEffectScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new AgentWorkValidationError("side_effect_scopes_invalid");
  }
  const scopes = value.map((item) => enumValue(
    String(item), agentWorkSideEffectScopes, "sideEffectScope",
  ));
  if (new Set(scopes).size !== scopes.length ||
      (scopes.includes("none") && scopes.length !== 1)) {
    throw new AgentWorkValidationError("side_effect_scopes_invalid");
  }
  return scopes;
}

function enumValue<const Value extends readonly string[]>(
  value: string,
  values: Value,
  name: string,
): Value[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value as Value[number];
}

function bounded(value: string, name: string, maximum: number) {
  if (typeof value !== "string" || value.trim().length < 1 ||
      Buffer.byteLength(value) > maximum) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value.trim();
}

function hash(value: string, name: string) {
  const result = bounded(value, name, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return result;
}

function integer(
  value: number | string,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return parsed;
}

function iso(value: Date | string, name: string) {
  return validDate(value instanceof Date ? value : new Date(value), name)
    .toISOString();
}

function validDate(value: Date, name: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value;
}
