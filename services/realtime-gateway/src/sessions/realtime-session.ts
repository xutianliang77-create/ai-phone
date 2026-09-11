import type {
  RealtimeSessionState,
  RealtimeTokenClaims,
  RealtimeVoiceConfig,
  PublicAdmissionReceipt,
} from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import type { RealtimeTtsOutputQueue } from "../tts/realtime-tts-output.js";
import type { PublicSessionEventSink } from "./public-session-event-sink.js";

export type RealtimeSessionStatus = Extract<
  RealtimeSessionState,
  "connecting" | "active" | "paused" | "ending" | "ended" | "failed"
>;

/** Same-process object references only. They are never serialized, shared
 * between Gateways, or exposed to a client. Their lifetime is bounded by the
 * original disconnect deadline. */
export interface PublicRecoveryRuntime {
  generation: number;
  provider: RealtimeProvider;
  ttsOutputQueue: RealtimeTtsOutputQueue;
  sessionEventSink: PublicSessionEventSink;
  release(): void;
}

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
  publicRecoveryRuntime?: PublicRecoveryRuntime;
}
