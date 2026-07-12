import type {
  PersistedRealtimeSessionState,
  RealtimeMode,
  SessionReviewResponse,
  SessionSegmentDto,
  RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";

export type SessionMode = RealtimeMode | "call_link";

export interface SessionRecord {
  id: string;
  userId: string;
  mode: SessionMode;
  status: PersistedRealtimeSessionState;
  consumedSeconds: number;
  createdAt: string;
  endedAt?: string;
  segments: SessionSegmentDto[];
  review?: SessionReviewResponse | null;
  diagnostics?: RealtimeSessionDiagnosticsDto;
}
