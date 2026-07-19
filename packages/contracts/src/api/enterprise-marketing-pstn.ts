export type EnterpriseMarketingPstnDispatchStatus =
  | "prepared"
  | "unknown"
  | "accepted"
  | "answered"
  | "completed"
  | "failed";

export interface EnterpriseMarketingPstnDispatchCounts {
  total: number;
  prepared: number;
  unknown: number;
  accepted: number;
  answered: number;
  completed: number;
  failed: number;
}

export interface EnterpriseMarketingPstnProviderReadinessDto {
  status: "ready" | "not_configured" | "not_ready";
  provider: "pstn_http" | "pstn_fonoster" | "unavailable";
  fingerprint?: string;
  reasonCode?: string;
}

export interface EnterpriseMarketingPstnStatusResponse {
  campaignId: string;
  dispatches: EnterpriseMarketingPstnDispatchCounts;
  provider: EnterpriseMarketingPstnProviderReadinessDto;
  billing: {
    category: "marketing_call_seconds";
    reservedSecondsPerDispatch: 60;
    settlement: "on_provider_acceptance";
  };
}

export interface EnterpriseMarketingPstnDispatchRequest {
  tenantId: string;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
  routeDocument: string;
  taskId: string;
  dispatchGeneration: number;
  claimToken: string;
}

export interface EnterpriseMarketingPstnDispatchResponse {
  status: "accepted" | "already_accepted" | "reconciliation_required";
  dispatchId: string;
  communicationSessionId: string;
  dispatchGeneration: number;
  provider: "pstn_http" | "pstn_fonoster";
  providerCallId?: string;
}

export interface EnterpriseMarketingPstnWebhookRequest {
  tenantId: string;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
  taskId: string;
  dispatchGeneration: number;
  eventId: string;
  callId?: string;
  providerCallId?: string;
  status: "in_progress" | "completed" | "failed";
  consumedSeconds?: number;
  failureReason?: string;
}

export interface EnterpriseMarketingPstnWebhookResponse {
  status: "accepted" | "duplicate" | "stale";
}
