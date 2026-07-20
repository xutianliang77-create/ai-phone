import type {
  EnterpriseMarketingAgentConversationState,
  EnterpriseMarketingAgentIntent,
} from "./enterprise-marketing-agent.js";
import type { EnterpriseMarketingPstnDispatchStatus } from
  "./enterprise-marketing-pstn.js";
import type { EnterpriseMarketingTaskStatus } from
  "./enterprise-marketing-scheduler.js";
import type { CommunicationProvider } from
  "../communication/provider-adapters.js";
import type {
  ProviderOperationStatus,
  ProviderOperationType,
} from "../communication/provider-operations.js";
import type { EnterpriseMarketingHandoffEvidenceDto } from
  "./enterprise-marketing-handoff.js";

export type EnterpriseMarketingMonitorAttention =
  | "none"
  | "warning"
  | "critical";

export interface EnterpriseMarketingMonitorCallDto {
  dispatchId: string;
  taskId: string;
  communicationSessionId: string;
  lead: {
    id: string;
    phoneHint: string;
  };
  provider: "pstn_http" | "pstn_fonoster";
  dispatchStatus: EnterpriseMarketingPstnDispatchStatus;
  taskStatus: EnterpriseMarketingTaskStatus;
  agent?: {
    runId: string;
    status: "active" | "handoff_requested" | "ending" | "completed" |
      "failed" | "cancelled";
    conversationState: EnterpriseMarketingAgentConversationState;
    disclosureDelivered: boolean;
    latestIntent?: EnterpriseMarketingAgentIntent;
    latestRiskSignals: string[];
    latestTurnStatus?: string;
  };
  attention: EnterpriseMarketingMonitorAttention;
  attentionReasons: string[];
  failureCodes: string[];
  timing: {
    preparedAt: string;
    acceptedAt?: string;
    answeredAt?: string;
    endedAt?: string;
    updatedAt: string;
    acceptanceLatencyMs?: number;
    answerLatencyMs?: number;
    stateAgeMs: number;
  };
}

export interface EnterpriseMarketingMonitoringSnapshotResponse {
  campaignId: string;
  generatedAt: string;
  transport: {
    mode: "snapshot";
    refreshAfterMs: 5000;
    streamStatus: "not_configured";
    reasonCode: "marketing_monitor_realtime_stream_not_configured";
  };
  counts: {
    total: number;
    active: number;
    attentionRequired: number;
    failed: number;
  };
  calls: EnterpriseMarketingMonitorCallDto[];
  truncated: boolean;
}

export interface EnterpriseMarketingMonitorCaptionDto {
  segmentId: string;
  revision: number;
  sourceText: string;
  translatedText?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  speakerRole?: string;
  startMs?: number;
  endMs?: number;
  updatedAt: string;
}

export interface EnterpriseMarketingMonitorAgentTurnDto {
  turnId: string;
  sequence: number;
  status: string;
  spokenText?: string;
  intent?: EnterpriseMarketingAgentIntent;
  conversationState?: EnterpriseMarketingAgentConversationState;
  action?: "continue" | "handoff" | "end_call";
  riskSignals: string[];
  knowledgeCitations: string[];
  failureCode?: string;
  ttsAuthorizedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseMarketingMonitoringCallResponse {
  generatedAt: string;
  call: EnterpriseMarketingMonitorCallDto;
  captions: {
    status: "available" | "no_samples";
    finalRevisions: EnterpriseMarketingMonitorCaptionDto[];
  };
  agentTurns: EnterpriseMarketingMonitorAgentTurnDto[];
  handoff?: EnterpriseMarketingHandoffEvidenceDto;
  providerOperations: Array<{
    id: string;
    provider: CommunicationProvider;
    operationType: ProviderOperationType;
    status: ProviderOperationStatus;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
  }>;
}
