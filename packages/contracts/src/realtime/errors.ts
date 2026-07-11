export type RealtimeErrorCode =
  | "invalid_token"
  | "quota_not_enough"
  | "provider_unavailable"
  | "provider_timeout"
  | "bad_event"
  | "internal_error";

export type RealtimeErrorStage =
  | "connection"
  | "session"
  | "provider"
  | "asr"
  | "translation"
  | "tts";

export interface RealtimeError {
  type: "error";
  sessionId?: string;
  code: RealtimeErrorCode;
  message: string;
  stage?: RealtimeErrorStage;
  provider?: string;
  retryable?: boolean;
}
