import { parseAgentWorkCreatePayload } from "@translation/contracts";
import { isEnabledEnvironmentValue } from "../../config/env.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { AgentPermissionRequestInput } from
  "./agent-work-permission-record.js";
import type { AgentWorkCreateInput } from "./agent-work-record.js";
import { defaultAgentWorkToolPolicyRegistry } from
  "./agent-work-tool-policy.js";
import type { CancelAgentWorkInput } from
  "./postgres-agent-work-mutations.js";
import type { ResolveAgentWorkPermissionInput } from
  "./postgres-agent-work-permission-resolution.js";

export async function requestAgentWorkPermission(
  input: AgentPermissionRequestInput,
) {
  const runtime = requireBackgroundWorkRuntime();
  const policy = defaultAgentWorkToolPolicyRegistry.require(
    input.toolName,
    input.toolVersion,
  );
  const scopesMatch = JSON.stringify([...policy.sideEffectScopes].sort()) ===
    JSON.stringify([...input.sideEffectScopes].sort());
  const ttl = Date.parse(input.expiresAt) - (input.now ?? new Date()).getTime();
  if (input.riskLevel !== policy.riskLevel || !scopesMatch || ttl <= 0 ||
      ttl > policy.maxTtlMs) {
    throw new AgentWorkRuntimeError("permission_tool_policy_mismatch");
  }
  await runtime.agentVoiceTurns.assertCurrent({
    agentRunId: input.agentRunId,
    sessionId: input.sessionId,
    legId: input.legId,
    turnId: input.turnId,
    actorId: input.actorId,
    turnGeneration: input.turnGeneration,
    dispatchGeneration: input.dispatchGeneration,
    explicitInstructionEvidenceHash: input.explicitInstructionEvidenceHash,
  });
  return runtime.agentWorkPermissions.request(input);
}

export function resolveAgentWorkPermission(
  input: ResolveAgentWorkPermissionInput,
) {
  return requireBackgroundWorkRuntime().agentWorkPermissions.resolve(input);
}

export async function createAgentWork(input: AgentWorkCreateInput) {
  const runtime = requireBackgroundWorkRuntime();
  const payload = parseAgentWorkCreatePayload(input.payload);
  defaultAgentWorkToolPolicyRegistry.assertCreatePayload(
    payload,
    input.now ?? new Date(),
  );
  await runtime.agentVoiceTurns.assertCurrent({
    agentRunId: input.agentRunId,
    sessionId: input.sessionId,
    legId: input.legId,
    turnId: input.turnId,
    actorId: input.actorId,
    turnGeneration: payload.turnGeneration,
    dispatchGeneration: payload.dispatchGeneration,
    explicitInstructionEvidenceHash:
      payload.explicitInstructionEvidenceHash,
  });
  await runtime.agentWorkPermissions.assertAuthorizationForWork({
    authorizationSnapshotId: payload.consentSnapshotId,
    agentRunId: input.agentRunId,
    sessionId: input.sessionId,
    legId: input.legId,
    turnId: input.turnId,
    actorId: input.actorId,
    payload,
    now: input.now,
  });
  return runtime.agentWorks.create({ ...input, payload });
}

export function cancelAgentWork(input: CancelAgentWorkInput) {
  return requireBackgroundWorkRuntime().agentWorks.cancel(input);
}

export async function findAgentWork(input: {
  workId: string;
  sessionId: string;
  actorId: string;
}) {
  const work = await requireBackgroundWorkRuntime().agentWorks.find(input.workId);
  return work && work.sessionId === input.sessionId && work.actorId === input.actorId
    ? work
    : null;
}

export async function findAgentWorkPermission(input: {
  permissionRequestId: string;
  sessionId: string;
  actorId: string;
}) {
  const request = await requireBackgroundWorkRuntime()
    .agentWorkPermissions.findRequest(input.permissionRequestId);
  return request && request.sessionId === input.sessionId &&
      request.actorId === input.actorId
    ? request
    : null;
}

export function listPendingAgentWorkPermissions(input: {
  sessionId: string;
  actorId: string;
  now?: Date;
  limit?: number;
}) {
  return requireBackgroundWorkRuntime().agentWorkPermissions.listPending(input);
}

export async function findAuthorizedAgentWorkPayload(input: {
  authorizationSnapshotId: string;
  sessionId: string;
  actorId: string;
}) {
  const payload = await requireBackgroundWorkRuntime()
    .agentWorkPermissions.findAuthorizedPayload(input.authorizationSnapshotId);
  return payload && payload.request.sessionId === input.sessionId &&
      payload.request.actorId === input.actorId
    ? payload
    : null;
}

export function findAgentWorkAuthorization(authorizationSnapshotId: string) {
  return requireBackgroundWorkRuntime().agentWorkPermissions
    .findAuthorization(authorizationSnapshotId);
}

export function claimAgentWorks(
  input: Parameters<PostgresRuntime["agentWorks"]["claim"]>[0],
) {
  return requireWorkRunnerRuntime().agentWorks.claim(input);
}

export function renewAgentWorkClaim(
  input: Parameters<PostgresRuntime["agentWorks"]["renewClaim"]>[0],
) {
  return requireWorkRunnerRuntime().agentWorks.renewClaim(input);
}

export function findClaimedAgentWorkExecutionPayload(
  input: Parameters<
    PostgresRuntime["agentWorks"]["findClaimedExecutionPayload"]
  >[0],
) {
  return requireWorkRunnerRuntime().agentWorks
    .findClaimedExecutionPayload(input);
}

export function transitionClaimedAgentWork(
  input: Parameters<PostgresRuntime["agentWorks"]["transition"]>[0],
) {
  return requireWorkRunnerRuntime().agentWorks.transition(input);
}

export function releaseClaimedAgentWorkForRetry(
  input: Parameters<PostgresRuntime["agentWorks"]["releaseForRetry"]>[0],
) {
  return requireWorkRunnerRuntime().agentWorks.releaseForRetry(input);
}

export function convergeAgentWork(
  input: Parameters<PostgresRuntime["agentWorks"]["converge"]>[0],
) {
  return requireWorkRunnerRuntime().agentWorks.converge(input);
}

export function listAgentWorkConvergenceCandidates(now?: Date, limit?: number) {
  return requireWorkRunnerRuntime().agentWorks
    .listConvergenceCandidates(now, limit);
}

export function isAgentBackgroundWorkEnabled() {
  return isEnabledEnvironmentValue(
    process.env.VOICE_AGENT_BACKGROUND_WORK_ENABLED,
  );
}

export function isAgentWorkRunnerEnabled() {
  return isAgentBackgroundWorkEnabled() &&
    isEnabledEnvironmentValue(process.env.VOICE_AGENT_WORK_RUNNER_ENABLED);
}

export function observeAgentVoiceTurn(
  input: Parameters<PostgresRuntime["agentVoiceTurns"]["observe"]>[0],
) {
  return requireBackgroundWorkRuntime().agentVoiceTurns.observe(input);
}

export function findCurrentAgentVoiceTurn(sessionId: string, legId: string) {
  return requireBackgroundWorkRuntime().agentVoiceTurns
    .findCurrent(sessionId, legId);
}

function requireBackgroundWorkRuntime() {
  if (!isAgentBackgroundWorkEnabled()) {
    throw new AgentWorkRuntimeError("agent_background_work_disabled");
  }
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    throw new AgentWorkRuntimeError("agent_background_work_requires_postgres");
  }
  return runtime.postgres;
}

function requireWorkRunnerRuntime() {
  if (!isAgentWorkRunnerEnabled()) {
    throw new AgentWorkRuntimeError("agent_work_runner_disabled");
  }
  return requireBackgroundWorkRuntime();
}

type PostgresRuntime = ReturnType<typeof requireBackgroundWorkRuntime>;

export class AgentWorkRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentWorkRuntimeError";
  }
}
