import type {
  PersistedRealtimeSessionState,
  CallPlaybackDto,
  RealtimeMode,
  SessionReviewResponse,
  SessionSegmentDto,
  RealtimeSessionDiagnosticsDto,
  RealtimeProcessingAuthorization,
} from "@translation/contracts";
import type {
  CallLegRecord,
  CallLinkMetadata,
} from "../call-links/call-link-record.js";
import type { ResultSyncState } from "./session-result-sync-contract.js";
import type { PublicRuntimePolicy, PublicRuntimeEvidence, PublicFinalizationRecord } from "./public-session-lifecycle.js";
import type { PublicInferenceAdmission } from "./public-runtime-admission.js";
import type { PublicInferenceEvidence } from "./public-inference-evidence.js";
import type {PublicModelAttemptRecord} from "./public-model-attempt.service.js";
import type {PublicModelRuntimeSnapshot} from "../models/public-model-runtime-config.js";

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
  homeRegion?: string;
  homeCellId?: string;
  routingGeneration?: number;
  processingAuthorization?: RealtimeProcessingAuthorization;
  processingDeploymentId?: string;
  resultSyncState?: ResultSyncState;
  publicRuntimePolicy?: PublicRuntimePolicy;
  publicInferenceAdmission?: PublicInferenceAdmission;
  publicInferenceEvidence?: PublicInferenceEvidence[];
  publicModelAttempts?:PublicModelAttemptRecord[];
  publicModelConfiguration?:PublicModelRuntimeSnapshot;
  publicRuntime?: PublicRuntimeEvidence;
  publicFinalization?: PublicFinalizationRecord;
}
