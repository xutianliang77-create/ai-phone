export type AiCallingAgentScenario =
  | "booking"
  | "customer_support"
  | "business_inquiry"
  | "custom";

export type AiCallingAgentStatus =
  | "draft"
  | "authorized"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "requires_human_takeover"
  | "takeover_requested"
  | "cancelled";

export interface CreateAiCallingAgentDraftRequest {
  scenario: AiCallingAgentScenario;
  objective: string;
  suggestedScript?: string;
  targetName?: string;
  targetPhone?: string;
  language?: "zh" | "en";
}

export interface AuthorizeAiCallingAgentRequest {
  userConfirmed: boolean;
  consentPromptVersion: string;
  recipientDisclosureConfirmed?: boolean;
  disclosurePromptVersion?: string;
}

export interface RequestAiCallingAgentTakeoverRequest {
  reason: string;
}

export interface CancelAiCallingAgentDraftRequest {
  reason?: string;
}

export interface StartAiCallingAgentCallRequest {
  consentPromptVersion?: string;
  disclosurePromptVersion?: string;
  recipientDisclosureConfirmed?: boolean;
}

export interface UpdateAiCallingAgentCallStatusRequest {
  status: "in_progress" | "completed" | "failed";
  providerCallId?: string;
  consumedSeconds?: number;
  resultSummary?: string;
  failureReason?: string;
  nextStep?: string;
}

export interface PstnAgentCallWebhookRequest extends UpdateAiCallingAgentCallStatusRequest {
  eventId: string;
  callId?: string;
}

export interface AiCallingAgentDraftDto {
  id: string;
  scenario: AiCallingAgentScenario;
  status: AiCallingAgentStatus;
  objective: string;
  suggestedScript: string;
  targetName?: string;
  targetPhone?: string;
  language: "zh" | "en";
  riskLevel: "low" | "requires_human_takeover";
  riskReasons: string[];
  consentPromptVersion?: string;
  recipientDisclosureConfirmed?: boolean;
  disclosurePromptVersion?: string;
  authorizedAt?: string;
  takeoverRequestedAt?: string;
  takeoverReason?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  callId?: string;
  providerCallId?: string;
  executionProvider?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  consumedSeconds?: number;
  usageSettledAt?: string;
  resultSummary?: string;
  failureReason?: string;
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiCallingAgentDraftResponse {
  draft: AiCallingAgentDraftDto;
}

export interface AiCallingAgentDraftsResponse {
  drafts: AiCallingAgentDraftDto[];
}
