import type { EnterpriseRuntimeTerminologyContextDto } from
  "./enterprise-terminology.js";

export type EnterpriseMarketingAgentConversationState =
  | "disclosure"
  | "qualifying"
  | "presenting"
  | "objection_handling"
  | "handoff"
  | "ending";

export type EnterpriseMarketingAgentIntent =
  | "qualify"
  | "inform"
  | "handle_objection"
  | "handoff"
  | "end";

export interface EnterpriseMarketingAgentProfileDto {
  id: string;
  campaignId: string;
  countryCode: string;
  locale: string;
  brandName: string;
  agentIdentity: string;
  callPurpose: string;
  productCode: string;
  valueProposition: string;
  targetMarket: string;
  termPackId: string;
  scriptTemplateId: string;
  voicePresetId: string;
  openingDisclosure: string;
  qualificationQuestions: string[];
  optOutPhrases: string[];
  handoffPhrases: string[];
  closingText: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface UpsertEnterpriseMarketingAgentProfileRequest {
  tenantId?: string;
  expectedVersion?: number;
  countryCode: string;
  locale: string;
  brandName: string;
  agentIdentity: string;
  callPurpose: string;
  productCode: string;
  valueProposition: string;
  targetMarket: string;
  termPackId: string;
  scriptTemplateId: string;
  voicePresetId: string;
  openingDisclosure: string;
  qualificationQuestions: string[];
  optOutPhrases: string[];
  handoffPhrases: string[];
  closingText: string;
}

export interface EnterpriseMarketingAgentReadinessDto {
  status: "ready" | "not_configured" | "not_ready";
  providerFingerprint?: string;
  reasonCode?: string;
}

export interface EnterpriseMarketingAgentStatusResponse {
  campaignId: string;
  profiles: EnterpriseMarketingAgentProfileDto[];
  provider: EnterpriseMarketingAgentReadinessDto;
  runtime: EnterpriseMarketingAgentReadinessDto;
}

export interface EnterpriseMarketingAgentProfileResponse {
  status: "created" | "updated" | "replayed";
  profile: EnterpriseMarketingAgentProfileDto;
}

export interface EnterpriseMarketingAgentTurnOutput {
  spokenText: string;
  intent: EnterpriseMarketingAgentIntent;
  conversationState: EnterpriseMarketingAgentConversationState;
  action: "continue" | "handoff" | "end_call";
  riskSignals: string[];
  knowledgeCitations: string[];
}

export interface EnterpriseMarketingAgentSnapshotResponse {
  status: "ready";
  runId: string;
  communicationSessionId: string;
  dispatchGeneration: number;
  locale: string;
  voicePresetId: string;
  conversationState: EnterpriseMarketingAgentConversationState;
  disclosure: {
    spokenText: string;
    authorized: boolean;
    delivered: boolean;
  };
}

export interface EnterpriseMarketingAgentTurnRequest {
  ticket: string;
  inputTurnId: string;
  idempotencyKey: string;
  customerText: string;
  detectedLocale: string;
}

export interface EnterpriseMarketingAgentTurnResponse {
  status: "generated" | "degraded" | "handoff" | "ended";
  runId: string;
  turnId: string;
  sequence: number;
  dispatchGeneration: number;
  output: EnterpriseMarketingAgentTurnOutput;
  stopAfterPlayout: boolean;
  providerFingerprint?: string;
  reasonCode?: string;
}

export interface EnterpriseMarketingAgentRuntimeContext {
  profile: EnterpriseMarketingAgentProfileDto;
  terminology: EnterpriseRuntimeTerminologyContextDto;
}
