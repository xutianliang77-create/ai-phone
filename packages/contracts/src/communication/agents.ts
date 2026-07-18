export type AgentExecutionMode = "assist" | "autonomous";
export type AgentRunStatus =
  | "ready"
  | "running"
  | "takeover_requested"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRunDto {
  id: string;
  taskId: string;
  sessionId?: string;
  attempt: number;
  mode: AgentExecutionMode;
  status: AgentRunStatus;
  policyVersion: string;
  modelProfileId?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failureCode?: string;
}

export type AgentStepDecisionType =
  | "suggest_response"
  | "entity_card"
  | "type_to_speak"
  | "tool_request"
  | "handoff"
  | "disclosure"
  | "amd_classification"
  | "ivr_navigation"
  | "runtime_event"
  | "structured_result";

export interface AgentStepDto {
  id: string;
  runId: string;
  sequence: number;
  decisionType: AgentStepDecisionType;
  inputTurnId?: string;
  outputSummary?: string;
  latencyMs?: number;
  status: "suggested" | "approved" | "rejected" | "executed" | "failed";
  idempotencyKey: string;
  createdAt: string;
}

export interface AgentToolExecutionDto {
  id: string;
  runId: string;
  stepId?: string;
  toolName: string;
  toolVersion: string;
  argumentsHash: string;
  riskLevel: "low" | "sensitive";
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  status: "requested" | "running" | "succeeded" | "failed" | "cancelled";
  idempotencyKey: string;
  providerOperationId?: string;
  resultSummary?: string;
  createdAt: string;
  endedAt?: string;
}

export interface AgentHandoffDto {
  id: string;
  runId: string;
  reason: string;
  redactedSummary: string;
  target: "user" | "operator";
  status: "requested" | "accepted" | "failed";
  requestedAt: string;
  acceptedAt?: string;
  failedAt?: string;
}

export type AgentConsultStatus =
  | "requested"
  | "dialing"
  | "connected"
  | "merging"
  | "merged"
  | "rejected"
  | "no_answer"
  | "failed"
  | "completed";

export interface AgentConsultDto {
  id: string;
  runId: string;
  handoffId: string;
  sessionId: string;
  mainRoomName: string;
  consultRoomName: string;
  operatorPhoneHash: string;
  operatorParticipantIdentity: string;
  status: AgentConsultStatus;
  idempotencyKey: string;
  requestHash: string;
  version: number;
  providerOperationId?: string;
  requestedAt: string;
  expiresAt: string;
  dialingAt?: string;
  connectedAt?: string;
  mergingAt?: string;
  mergedAt?: string;
  rejectedAt?: string;
  failedAt?: string;
  completedAt?: string;
  failureCode?: string;
  billableSeconds?: number;
  updatedAt: string;
}

export interface AgentAssistTurnDto {
  speakerRole: "user" | "remote";
  text: string;
}

export interface RequestAgentAssistSuggestion {
  humanPresent: boolean;
  inputTurnId: string;
  latestUtterance: string;
  recentTurns?: AgentAssistTurnDto[];
  idempotencyKey: string;
}

export interface AgentAssistSuggestionDto {
  text: string;
  intent: string;
  warnings: string[];
  requiresUserAction: true;
  source: "llm" | "script_fallback";
}

export interface AgentAssistSuggestionResponse {
  run: AgentRunDto;
  step: AgentStepDto;
  suggestion: AgentAssistSuggestionDto;
  replayed: boolean;
}
