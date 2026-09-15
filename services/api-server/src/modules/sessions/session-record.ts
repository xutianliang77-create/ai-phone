import type {
  PersistedRealtimeSessionState,
  CallPlaybackDto,
  RealtimeMode,
  SessionReviewResponse,
  SessionSegmentDto,
  RealtimeSessionDiagnosticsDto,
  RealtimeProcessingAuthorization,
  CreateRealtimeSessionRequest,
  RealtimeTokenClaims,
} from "@translation/contracts";
import type {
  CallLegRecord,
  CallLinkMetadata,
} from "../call-links/call-link-record.js";
import type { ResultSyncState } from "./session-result-sync-contract.js";
import type { PublicRuntimePolicy, PublicRuntimeEvidence, PublicFinalizationRecord, PublicRecoveryOwnership } from "./public-session-lifecycle.js";
import type { PublicInferenceAdmission } from "./public-runtime-admission.js";
import type { PublicInferenceEvidence } from "./public-inference-evidence.js";
import type {PublicModelAttemptRecord} from "./public-model-attempt.service.js";
import type {PublicModelRuntimeSnapshot} from "../models/public-model-runtime-config.js";
import type {PublicProviderReconciliationRecord} from "./public-provider-reconciliation.js";

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
  publicProviderReconciliation?:PublicProviderReconciliationRecord;
  publicModelConfiguration?:PublicModelRuntimeSnapshot;
  publicCreationRequest?:{requestHash:string;request:CreateRealtimeSessionRequest};
  /** Durable tombstone for a cancelled/expired public HTTP creation identity.
   * It prevents a late replay from reopening the deterministic session id. */
  publicCreationRetirement?:{action:"cancelled"|"expired";requestHash:string;retiredAt:string};
  /** No signed token or signing/provider secret is stored in the session. */
  publicRealtimeIssuance?:{requestHash:string;endpoint:string;claims:RealtimeTokenClaims;holdId:string};
  publicRuntime?: PublicRuntimeEvidence;
  publicRecoveryOwnership?: PublicRecoveryOwnership;
  publicFinalization?: PublicFinalizationRecord;
  /**
   * Set only by the account-deletion workflow. It is a fail-closed runtime
   * boundary, not a session terminal state: verified finalization must still
   * complete exactly once before the content can be erased.
   */
  accountDeletionRequestedAt?: string;
}
