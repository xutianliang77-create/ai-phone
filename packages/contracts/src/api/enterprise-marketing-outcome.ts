export type EnterpriseMarketingDisposition =
  | "no_interest"
  | "potential_lead"
  | "appointment_requested"
  | "follow_up_required"
  | "do_not_contact"
  | "invalid_number"
  | "call_failed"
  | "completed_unclassified";

export type EnterpriseMarketingIntentLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "unknown";

export type EnterpriseMarketingOutcomeEvidenceType =
  | "transcript_segment"
  | "agent_turn"
  | "dispatch"
  | "agent_run"
  | "suppression"
  | "handoff";

export type EnterpriseMarketingNextActionKind =
  | "callback"
  | "appointment_request"
  | "send_material"
  | "manual_review";

export interface EnterpriseMarketingOutcomeEvidenceRef {
  type: "transcript_segment" | "agent_turn";
  id: string;
}

export interface EnterpriseMarketingOutcomeEvidenceDto {
  type: EnterpriseMarketingOutcomeEvidenceType;
  id: string;
  contentHash: string;
  revision?: number;
  observedAt?: string;
}

export interface EnterpriseMarketingNextActionDto {
  id: string;
  kind: EnterpriseMarketingNextActionKind;
  status: "requested";
  dueAt?: string;
  evidenceHash: string;
  createdAt: string;
}

export interface EnterpriseMarketingOutcomeDto {
  id: string;
  campaignId: string;
  taskId: string;
  dispatchId: string;
  communicationSessionId: string;
  lead: { id: string; phoneHint: string };
  agentRunId?: string;
  disposition: EnterpriseMarketingDisposition;
  intentLevel: EnterpriseMarketingIntentLevel;
  summary: string;
  evidence: EnterpriseMarketingOutcomeEvidenceDto[];
  evidenceHash: string;
  sourceHash: string;
  nextAction?: EnterpriseMarketingNextActionDto;
  createdAt: string;
  version: number;
}

export interface CreateEnterpriseMarketingOutcomeRequest {
  tenantId?: string;
  dispatchId: string;
  disposition: EnterpriseMarketingDisposition;
  intentLevel: EnterpriseMarketingIntentLevel;
  summary: string;
  evidence: EnterpriseMarketingOutcomeEvidenceRef[];
  nextAction?: {
    kind: EnterpriseMarketingNextActionKind;
    dueAt?: string;
  };
}

export interface EnterpriseMarketingOutcomeResponse {
  status: "created" | "replayed";
  outcome: EnterpriseMarketingOutcomeDto;
}

export interface EnterpriseMarketingOutcomeListResponse {
  campaignId: string;
  generatedAt: string;
  counts: {
    finalized: number;
    nextActionRequested: number;
  };
  outcomes: EnterpriseMarketingOutcomeDto[];
  truncated: boolean;
}
