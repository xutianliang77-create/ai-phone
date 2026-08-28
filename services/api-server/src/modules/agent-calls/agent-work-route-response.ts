import type {
  AgentVoiceTurnScopeDto,
  AgentWorkDto,
  VoiceAgentPermissionRequestDto,
} from "@translation/contracts";
import type { AgentVoiceTurnScopeRecord } from "./agent-voice-turn-scope.js";
import type { AgentPermissionRequestRecord } from
  "./agent-work-permission-record.js";
import type { AgentWorkRecord } from "./agent-work-record.js";

export function toAgentVoiceTurnScopeDto(
  scope: AgentVoiceTurnScopeRecord,
): AgentVoiceTurnScopeDto {
  return {
    sessionId: scope.sessionId,
    legId: scope.legId,
    actorId: scope.actorId,
    agentRunId: scope.agentRunId,
    turnId: scope.currentTurnId,
    turnGeneration: scope.turnGeneration,
    dispatchGeneration: scope.dispatchGeneration,
    state: scope.state,
    ...(scope.explicitInstructionEvidenceHash
      ? { explicitInstructionEvidenceHash:
          scope.explicitInstructionEvidenceHash }
      : {}),
    observedAt: scope.observedAt,
  };
}

export function toVoiceAgentPermissionRequestDto(
  request: AgentPermissionRequestRecord,
): VoiceAgentPermissionRequestDto {
  return {
    permissionRequestId: request.permissionRequestId,
    sessionId: request.sessionId,
    legId: request.legId,
    turnId: request.turnId,
    actorId: request.actorId,
    toolName: request.toolName,
    toolVersion: request.toolVersion,
    argumentsHash: request.argumentsHash,
    explicitInstructionEvidenceHash:
      request.explicitInstructionEvidenceHash,
    policyVersion: request.policyVersion,
    riskLevel: request.riskLevel,
    sideEffectScopes: request.sideEffectScopes,
    status: request.status,
    turnGeneration: request.turnGeneration,
    dispatchGeneration: request.dispatchGeneration,
    ...(request.authorizationSnapshotId
      ? { authorizationSnapshotId: request.authorizationSnapshotId }
      : {}),
    expiresAt: request.expiresAt,
  };
}

export function toAgentWorkDto(work: AgentWorkRecord): AgentWorkDto {
  return {
    workId: work.workId,
    agentRunId: work.agentRunId,
    sessionId: work.sessionId,
    legId: work.legId,
    turnId: work.turnId,
    actorId: work.actorId,
    toolName: work.toolName,
    toolVersion: work.toolVersion,
    submissionKey: work.submissionKey,
    argumentsHash: work.argumentsHash,
    consentSnapshotId: work.consentSnapshotId,
    explicitInstructionEvidenceHash:
      work.explicitInstructionEvidenceHash,
    policyVersion: work.policyVersion,
    riskLevel: work.riskLevel,
    sideEffectScopes: work.sideEffectScopes,
    priority: work.priority,
    status: work.status,
    turnGeneration: work.turnGeneration,
    dispatchGeneration: work.dispatchGeneration,
    attempt: work.attempt,
    maxAttempts: work.maxAttempts,
    maxRuntimeMs: work.maxRuntimeMs,
    createdAt: work.createdAt,
    expiresAt: work.expiresAt,
    ...(work.startedAt ? { startedAt: work.startedAt } : {}),
    ...(work.endedAt ? { endedAt: work.endedAt } : {}),
    ...(work.failureCode ? { failureCode: work.failureCode } : {}),
  };
}
