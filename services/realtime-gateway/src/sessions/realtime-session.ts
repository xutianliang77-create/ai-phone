import type { RealtimeTokenClaims } from "@translation/contracts";

export type RealtimeSessionStatus = "active" | "paused" | "ended";

export interface RealtimeSession {
  id: string;
  userId: string;
  claims: RealtimeTokenClaims;
  status: RealtimeSessionStatus;
  startedAt: number;
  billableSeconds: number;
}
