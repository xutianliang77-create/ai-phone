import type {
  PersistedRealtimeSessionState,
  CallPlaybackDto,
  RealtimeMode,
  SessionReviewResponse,
  SessionSegmentDto,
  RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";
import type {
  CallLegRecord,
  CallLinkMetadata,
} from "../call-links/call-link-record.js";

export type SessionMode = RealtimeMode | "call_link";

export interface SessionRecord {
  id: string;
  userId: string;
  mode: SessionMode;
  status: PersistedRealtimeSessionState;
  consumedSeconds: number;
  createdAt: string;
  version?: number;
  lastActivityAt?: string;
  endedAt?: string;
  segments: SessionSegmentDto[];
  callLink?: CallLinkMetadata;
  callLegs?: CallLegRecord[];
  playbacks?: CallPlaybackDto[];
  review?: SessionReviewResponse | null;
  diagnostics?: RealtimeSessionDiagnosticsDto;
  finalizationIdempotencyKey?: string;
  finalizedAt?: string;
}
