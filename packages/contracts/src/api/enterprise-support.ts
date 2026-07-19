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
