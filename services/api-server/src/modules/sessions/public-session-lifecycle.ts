import type { PublicFinalizeAck, PublicFinalizeRequest, RealtimeStopWatermark } from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";
import { resultSyncHash, ResultSyncError, syncKey } from "./session-result-sync-contract.js";

export const PUBLIC_RECOVERY_MS = 300_000;
// Two existing 30-second Gateway usage ticks, allowing bounded delivery jitter.
export const PUBLIC_EVIDENCE_GAP_MS = 60_000;
/** Assigned by server admission, never by a mobile request. S4 wires its issuer. */
export interface PublicRuntimePolicy {
  /** Present on leases issued from a dedicated server-side inference admission. */
  admissionHash?: string;
  sampleRate?: 16000|24000;
  leaseId: string; captureId: string; languagePolicyKey: string;
  expiresAt: string; maxActiveSeconds: number;
}
export interface PublicRuntimeEvidence {
  sequence: number; eventHash: string; phase: "active" | "paused" | "disconnected" | "stopped";
  observedAt: string; activeMs: number; uncertain: boolean;
  lastAcceptedSample: number; finalRevision: number;
  recoveryUntil?: string; stoppedAt?: string;
  finalRevisions?: Record<string, number>;
}
export interface PublicFinalizationRecord { requestHash: string; ack: PublicFinalizeAck; }
export function runtimePolicy(session: SessionRecord) {
  const p=session.publicRuntimePolicy;
  if(!p || ![p.leaseId,p.captureId,p.languagePolicyKey].every(syncKey) ||
      !Number.isFinite(Date.parse(p.expiresAt)) || !Number.isSafeInteger(p.maxActiveSeconds) ||
      p.maxActiveSeconds<1 || p.maxActiveSeconds>86400) throw new ResultSyncError("public_runtime_not_ready",503);
  return p;
}
export function stopWatermark(session: SessionRecord): RealtimeStopWatermark {
  const p=runtimePolicy(session),r=session.publicRuntime;
  if(!r || r.phase!=="stopped" || !r.stoppedAt) throw new ResultSyncError("public_stop_not_confirmed",503);
  return {captureId:p.captureId,languagePolicyKey:p.languagePolicyKey,
    finalRevision:r.finalRevision,lastAcceptedSample:r.lastAcceptedSample};
}
export function parsePublicFinalize(value: unknown, sessionId: string): PublicFinalizeRequest {
  const b=value as Record<string,unknown>|null;
  const w=b?.stopWatermark as Record<string,unknown>|undefined;
  if(!b || Array.isArray(b) || Object.keys(b).some(k=>!["operation","contractVersion","deploymentId",
    "modelPolicyRevision","sessionId","idempotencyKey","stopWatermark"].includes(k)) ||
    b.operation!=="finalize" || b.contractVersion!==1 || b.sessionId!==sessionId ||
    b.idempotencyKey!==`finalize:${sessionId}` || !syncKey(b.deploymentId) || !syncKey(b.modelPolicyRevision) ||
    !w || Array.isArray(w) || Object.keys(w).length!==4 || !syncKey(w.captureId) || !syncKey(w.languagePolicyKey) ||
    !Number.isSafeInteger(w.finalRevision)||Number(w.finalRevision)<0 ||
    !Number.isSafeInteger(w.lastAcceptedSample)||Number(w.lastAcceptedSample)<0) {
    throw new ResultSyncError("invalid_public_finalization",400);
  }
  return structuredClone(b) as unknown as PublicFinalizeRequest;
}
export function validatePublicStop(session: SessionRecord, request: PublicFinalizeRequest) {
  if(resultSyncHash(stopWatermark(session))!==resultSyncHash(request.stopWatermark)) {
    throw new ResultSyncError("public_stop_watermark_conflict");
  }
  if(session.publicRuntime!.uncertain) throw new ResultSyncError("public_meter_uncertain",503);
}
export function withinPublicTailWindow(session:SessionRecord,now:Date) {
  const r=session.publicRuntime;
  return !!r?.stoppedAt && !r.uncertain && now.getTime()<=Date.parse(r.recoveryUntil??"");
}
