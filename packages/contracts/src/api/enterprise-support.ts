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
