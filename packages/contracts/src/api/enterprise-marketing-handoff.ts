export type EnterpriseMarketingHandoffTimeoutAction = "end_call" | "callback";

export interface EnterpriseMarketingHandoffPolicyDto {
  id: string;
  campaignId: string;
  supportQueueId: string;
  supportChannelId: string;
  timeoutSeconds: number;
  timeoutAction: EnterpriseMarketingHandoffTimeoutAction;
  callbackDelaySeconds?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface UpsertEnterpriseMarketingHandoffPolicyRequest {
  tenantId?: string;
  supportQueueId: string;
  supportChannelId: string;
  timeoutSeconds: number;
  timeoutAction: EnterpriseMarketingHandoffTimeoutAction;
  callbackDelaySeconds?: number;
  expectedVersion?: number;
}

export interface EnterpriseMarketingHandoffStatusResponse {
  campaignId: string;
  policy?: EnterpriseMarketingHandoffPolicyDto;
  readiness: {
    status: "ready" | "not_configured" | "not_ready";
    reasonCode?: string;
  };
  provider: {
    status: "ready" | "not_configured" | "not_ready";
    provider?: "pstn_http" | "pstn_fonoster";
    fingerprint?: string;
    reasonCode?: string;
    aiStopDeadlineMs: 300;
  };
}

export interface EnterpriseMarketingHandoffPolicyResponse {
  status: "created" | "updated";
  policy: EnterpriseMarketingHandoffPolicyDto;
}

export interface EnterpriseMarketingHandoffEvidenceDto {
  id: string;
  communicationSessionId: string;
  supportSessionId: string;
  supportQueueId: string;
  status: "queued" | "media_not_ready" | "active" | "timed_out" |
    "callback_required" | "failed" | "completed";
  timeoutAction: EnterpriseMarketingHandoffTimeoutAction;
  aiFence: { status: "stopped"; verifiedAt: string; deadlineMs: 300 };
  media: {
    status: "pending" | "not_ready" | "active" | "failed" | "completed";
    providerFingerprint?: string;
    requestedAt?: string;
    aiAudioStoppedAt?: string;
    operatorJoinedAt?: string;
    completedAt?: string;
    receiptHash?: string;
    reasonCode?: string;
  };
  timeoutAt: string;
  createdAt: string;
  updatedAt: string;
}
