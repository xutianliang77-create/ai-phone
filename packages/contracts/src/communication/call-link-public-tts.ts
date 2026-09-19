/**
 * Internal Call Link Worker material contract. The material is scoped to one
 * dispatch generation and is never sent to a phone, browser, log, or durable
 * session record. Credentials are intentionally absent from the persisted
 * snapshot type below.
 */
export interface CallLinkPublicTtsProfile {
  providerId: "tencent";
  protocol: "tencent_tts_ws";
  endpoint: string;
  modelId: string;
  appId: string;
  voice: string;
  volume: number;
  timeoutMs: number;
  sampleRate: 16000 | 24000;
}

export interface CallLinkPublicTtsAttemptMetadata {
  requestId?: string;
  usage?: {
    /** Supplier-reported/derived metadata only. It is never customer billing. */
    billedCharacters?: number;
  };
}

export type CallLinkPublicTtsAttemptState =
  | "dispatching"
  | "confirmed"
  | "rejected"
  | "not_sent"
  | "uncertain";

export interface CallLinkPublicTtsAttemptEvent {
  callId: string;
  sessionId: string;
  attemptId: string;
  segmentId: string;
  revision: number;
  providerId: "tencent";
  modelId: string;
  state: CallLinkPublicTtsAttemptState;
  failureCode?: string;
  metadata?: CallLinkPublicTtsAttemptMetadata;
}

export interface CallLinkPublicTtsAttemptAck {
  event: CallLinkPublicTtsAttemptEvent;
  recordedAt: string;
  /** Call Link customer settlement remains its original session ledger. */
  costStatus: "unknown";
}

export interface CallLinkPublicTtsMaterial {
  callId: string;
  sessionId: string;
  generation: number;
  workerId: string;
  jobId: string;
  profile: CallLinkPublicTtsProfile;
  /** Raw values are transient process material. Do not log or persist them. */
  credentials: {
    secretId: string;
    secretKey: string;
  };
}
