import type {
  AgentExecutionMode,
  AgentRunDto,
} from "./agents.js";
import type { AiCallingAgentScenario } from "../api/agent-calls.js";

export type VoiceAgentAmdCategory =
  | "human"
  | "machine-ivr"
  | "machine-vm"
  | "machine-unavailable"
  | "uncertain";

export type VoiceAgentRuntimeEventType =
  | "ready"
  | "heartbeat"
  | "disclosure_started"
  | "disclosure_completed"
  | "recording_consent"
  | "amd_classified"
  | "ivr_detected"
  | "takeover_ready"
  | "structured_result"
  | "failed"
  | "ending";

export type VoiceAgentRuntimeCommand =
  | "continue"
  | "takeover"
  | "cancel";

export interface VoiceAgentControlMessage {
  version: 1;
  controlId: string;
  callId: string;
  generation: number;
  command: "takeover" | "cancel" | "resume";
  issuedAt: string;
  expiresAt: string;
}

export interface VoiceAgentStructuredResultDto {
  outcome: "completed" | "partial" | "unresolved" | "failed";
  summary: string;
  evidence: string[];
  unresolvedItems: string[];
  nextStep?: string;
}

export interface VoiceAgentRecordingConsentEvent {
  status: "granted" | "revoked";
  policyVersion: string;
  evidenceHash: string;
  observedAt: string;
}

export interface VoiceAgentRuntimeSnapshotDto {
  draftId: string;
  callId: string;
  sessionId: string;
  roomName: string;
  participantIdentity: string;
  sipParticipantIdentity: string;
  generation: number;
  run: AgentRunDto;
  mode: Extract<AgentExecutionMode, "autonomous">;
  scenario: AiCallingAgentScenario;
  language: "zh" | "en";
  objective: string;
  approvedScript: string;
  disclosureText: string;
  disclosurePromptVersion: string;
  recordingConsent?: {
    policyVersion: string;
    promptText: string;
    expiresAt: string;
  };
}

export interface VoiceAgentRuntimeEventRequest {
  ticket: string;
  eventId: string;
  event: VoiceAgentRuntimeEventType;
  workerId?: string;
  jobId?: string;
  errorClass?: string;
  amdCategory?: VoiceAgentAmdCategory;
  transcriptSummary?: string;
  recordingConsent?: VoiceAgentRecordingConsentEvent;
  result?: VoiceAgentStructuredResultDto;
}

export interface VoiceAgentRuntimeEventResponse {
  callId: string;
  generation: number;
  dispatchStatus: string;
  command: VoiceAgentRuntimeCommand;
  leaseExpiresAt: string;
  replayed: boolean;
}

export interface VoiceAgentToolRequest {
  ticket: string;
  idempotencyKey: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
}

export interface VoiceAgentToolAuthorization {
  executionId: string;
  authorized: boolean;
  reason?: string;
}
