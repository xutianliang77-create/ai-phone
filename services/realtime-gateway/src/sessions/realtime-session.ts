import type {
  RealtimeSessionState,
  RealtimeTokenClaims,
  RealtimeVoiceConfig,
  PublicAdmissionReceipt,
} from "@translation/contracts";

export type RealtimeSessionStatus = Extract<
  RealtimeSessionState,
  "connecting" | "active" | "paused" | "ending" | "ended" | "failed"
>;

export interface RealtimeSession {
  id: string;
  userId: string;
  claims: RealtimeTokenClaims;
  voiceOutputEnabled?: boolean;
  voice?: RealtimeVoiceConfig;
  status: RealtimeSessionStatus;
  startedAt: number;
  activeStartedAt?: number;
  accumulatedActiveMs: number;
  connectionGeneration: number;
  billableSeconds: number;
  reconnectStatus?: Extract<RealtimeSessionStatus, "active" | "paused">;
  disconnectDeadlineAt?: number;
  publicDisconnect?:{generation:number;receipt:PublicAdmissionReceipt};
}
