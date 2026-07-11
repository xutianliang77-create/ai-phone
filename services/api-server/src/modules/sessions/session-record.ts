import type {
  RealtimeMode,
  SessionReviewResponse,
  SessionSegmentDto,
} from "@translation/contracts";

export type SessionMode = RealtimeMode | "call_link";

export interface SessionRecord {
  id: string;
  userId: string;
  mode: SessionMode;
  status: "created" | "active" | "paused" | "ended" | "failed";
  consumedSeconds: number;
  createdAt: string;
  endedAt?: string;
  segments: SessionSegmentDto[];
  review?: SessionReviewResponse | null;
}
