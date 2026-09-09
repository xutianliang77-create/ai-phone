import type { RealtimeStopWatermark } from "./processing-contract.js";

/** Internal authenticated Gateway observation, not a mobile command. */
export interface PublicRuntimeObservation extends RealtimeStopWatermark {
  leaseId: string;
  sequence: number;
  phase: "active" | "paused" | "disconnected" | "stopped";
}

/** Internal receipt: a successful HTTP status alone does not confirm a watermark. */
export interface PublicRuntimeAck extends PublicRuntimeObservation {
  sessionId: string;
  deploymentId: string;
  ownerId: string;
  modelPolicyRevision: string;
  meterStatus: "verified" | "uncertain";
}

export interface PublicFinalizeRequest {
  operation: "finalize";
  contractVersion: 1;
  deploymentId: string;
  modelPolicyRevision: string;
  sessionId: string;
  idempotencyKey: string;
  stopWatermark: RealtimeStopWatermark;
}
export interface PublicFinalizeAck {
  operation: "finalize";
  contractVersion: 1;
  sessionId: string;
  deploymentId: string;
  ownerId: string;
  modelPolicyRevision: string;
  idempotencyKey: string;
  status: "ended";
  consumedSeconds: number;
  meterBasis: "server_observed_active_ms";
  stopWatermark: RealtimeStopWatermark;
  finalizedAt: string;
  createdAt: string;
  endedAt: string;
}
export interface PublicRecoveryStatus {
  contractVersion: 1;
  sessionId: string;
  deploymentId: string;
  ownerId: string;
  modelPolicyRevision: string;
  canResume: boolean;
  canFinalize: boolean;
  recoveryUntil?: string;
  meterStatus: "missing" | "verified" | "uncertain";
  stopWatermark?: RealtimeStopWatermark;
  finalization?: PublicFinalizeAck;
}
