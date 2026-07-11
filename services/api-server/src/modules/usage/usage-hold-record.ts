export type UsageHoldStatus = "active" | "released" | "settled";

export interface UsageHoldRecord {
  id: string;
  userId: string;
  seconds: number;
  status: UsageHoldStatus;
  createdAt: string;
  expiresAt: string;
  sessionId?: string;
  idempotencyKey?: string;
  note?: string;
  releasedAt?: string;
  settledAt?: string;
  settledSeconds?: number;
}
