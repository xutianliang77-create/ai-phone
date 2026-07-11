import type {
  RealtimeSessionState,
  RealtimeTokenClaims,
} from "@translation/contracts";

export type RealtimeSessionStatus = Extract<
  RealtimeSessionState,
  "active" | "paused" | "ending" | "ended" | "failed"
>;

export interface RealtimeSession {
  id: string;
  userId: string;
  claims: RealtimeTokenClaims;
  status: RealtimeSessionStatus;
  startedAt: number;
  billableSeconds: number;
}
