export type EnterpriseSupportInboundChannelType = "pstn" | "web" | "app";

export interface EnterpriseSupportInboundAuthorizationRequest {
  tenantId: string;
  channelId: string;
  channelType: EnterpriseSupportInboundChannelType;
}

export interface EnterpriseSupportInboundEvent {
  source: string;
  sourceEventId: string;
  customerKeyHash: string;
  phoneHash?: string;
  displayName?: string;
  locale?: string;
  intent?: string;
  priority: number;
  occurredAt: string;
}

export interface EnterpriseSupportInboundRequest {
  ticket: string;
  event: EnterpriseSupportInboundEvent;
}

export interface EnterpriseSupportInboundAcceptedResponse {
  status: "created" | "replayed";
  sessionId: string;
  communicationSessionId: string;
}

export interface EnterpriseSupportRagRequest {
  query: string;
  locale: string;
  countryCode: string;
  productCode: string;
  limit?: number;
}

export interface EnterpriseSupportRagEvidence {
  knowledgeVersionId: string;
  sourceId: string;
  revision: number;
  blockId: string;
  content: string;
  contentHash: string;
  citation: string;
}

export type EnterpriseSupportRagResponse =
  | {
      status: "grounded";
      sessionId: string;
      directive: "answer_with_citations";
      evidence: EnterpriseSupportRagEvidence[];
    }
  | {
      status: "no_evidence";
      sessionId: string;
      directive: "state_uncertain_and_offer_handoff";
      message: string;
      handoffRecommended: true;
      evidence: [];
    };

export type EnterpriseSupportAgentIntent =
  | "qualify"
  | "answer"
  | "handoff"
  | "end";

export type EnterpriseSupportAgentConversationState =
  | "qualifying"
  | "answering"
  | "handoff"
  | "ending";

export interface EnterpriseSupportAgentTurnOutput {
  spokenText: string;
  intent: EnterpriseSupportAgentIntent;
  toolRequest: null;
  riskSignals: string[];
  knowledgeCitations: string[];
  conversationState: EnterpriseSupportAgentConversationState;
}

export interface EnterpriseSupportAgentDispatchResponse {
  status: "ready";
  ticket: string;
  runId: string;
  sessionId: string;
  communicationSessionId: string;
  roomName: string;
  agentName: string;
  generation: number;
  expiresAt: string;
}

export interface EnterpriseSupportAgentWorkerSnapshot {
  runId: string;
  sessionId: string;
  communicationSessionId: string;
  roomName: string;
  generation: number;
  locale: string;
  countryCode: string;
  productCode: string;
  conversationState: EnterpriseSupportAgentConversationState;
}

export interface EnterpriseSupportAgentRecentTurn {
  role: "customer" | "assistant";
  text: string;
}

export interface EnterpriseSupportAgentTurnRequest {
  ticket: string;
  workerCellId: string;
  workerId: string;
  inputTurnId: string;
  idempotencyKey: string;
  customerText: string;
  recentTurns: EnterpriseSupportAgentRecentTurn[];
}

export interface EnterpriseSupportAgentTurnResponse {
  status: "generated" | "degraded" | "handoff";
  turnId: string;
  sequence: number;
  generation: number;
  output: EnterpriseSupportAgentTurnOutput;
  providerFingerprint?: string;
  reasonCode?: string;
}
