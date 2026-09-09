import { randomUUID } from "node:crypto";
import { parseRealtimeProcessingRequest, type RealtimeSegmentSyncAck } from "@translation/contracts";
import { getStoreSnapshot, persistStoreSnapshot, runStoreTransaction } from "../../infrastructure/storage/json-store.js";
import { mutateSessionRecord,findSession } from "./sessions-runtime.repository.js";
import { mergeSessionSegments } from "./session-segment-merge.js";
import type { SessionRecord } from "./session-record.js";
import { parseResultSync, resultSyncHash, ResultSyncError, RESULT_SYNC_CONSENT_VERSION,
  syncKey, syncTextProjection, type ResultSyncState } from "./session-result-sync-contract.js";
import {withinPublicTailWindow} from "./public-session-lifecycle.js";

export { deployment as publicDeploymentId, boundSession as assertPublicSession, mutate as mutatePublicSession };

function deployment() {
  const id = process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
  if (!syncKey(id)) throw new ResultSyncError("result_sync_contract_not_ready", 503);
  return id;
}
function boundSession(session: SessionRecord, ownerId: string, deploymentId: string) {
  if (session.userId !== ownerId) throw new ResultSyncError("forbidden", 403);
  if (session.processingDeploymentId !== deploymentId ||
      session.processingAuthorization?.processingMode !== "online" ||
      session.processingAuthorization.contractVersion !== 1) {
    throw new ResultSyncError("result_sync_session_not_authorized", 403);
  }
  const auth = session.processingAuthorization;
  if (parseRealtimeProcessingRequest({contractVersion:auth.contractVersion,
    processingMode:auth.processingMode,modelPolicyRevision:auth.modelPolicyRevision,
    languagePolicy:auth.languagePolicy,executionPlan:auth.executionPlan,syncRequested:false}).status !== "valid") {
    throw new ResultSyncError("result_sync_session_not_authorized", 403);
  }
}
async function mutate<T>(sessionId: string, operation: string, payload: unknown,
    plan: (current: SessionRecord) => { next: SessionRecord | null; result: T }) {
  // Same aggregate mutation contains segments AND receipt. Reuse the existing
  // PostgreSQL fence/CAS or legacy synchronous snapshot transaction.
  const result = await mutateSessionRecord(sessionId, operation, payload, plan, () => runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const index = store.sessions.findIndex(s => s.id === sessionId);
    if (index < 0) return null;
    const current = store.sessions[index];
    const change = plan(current);
    if (change.next) {
      change.next.version = (current.version ?? 1) + 1;
      store.sessions[index] = change.next;
      persistStoreSnapshot();
    }
    return change.result;
  }));
  if (result === null) throw new ResultSyncError("session_not_found", 404);
  return result;
}

export function setResultSyncConsent(sessionId: string, ownerId: string, body: unknown, now = new Date()) {
  const deploymentId = deployment();
  const request = body as Record<string, unknown> | null;
  if (!request || Array.isArray(request) ||
      Object.keys(request).some(k => !["deploymentId", "modelPolicyRevision", "consentVersion", "allowed","expectedRevision"].includes(k)) ||
      request.deploymentId !== deploymentId || !syncKey(request.modelPolicyRevision) ||
      request.consentVersion !== RESULT_SYNC_CONSENT_VERSION || typeof request.allowed !== "boolean" ||
      !Number.isSafeInteger(request.expectedRevision) || Number(request.expectedRevision)<0) {
    throw new ResultSyncError("invalid_result_sync_consent", 400);
  }
  return mutate(sessionId, "result-sync-consent", request, current => {
    boundSession(current, ownerId, deploymentId);
    if (current.processingAuthorization!.modelPolicyRevision !== request.modelPolicyRevision) {
      throw new ResultSyncError("result_sync_policy_mismatch");
    }
    if (request.allowed && !["active", "paused", "connecting"].includes(current.status)) {
      throw new ResultSyncError("result_sync_session_terminal");
    }
    const next = structuredClone(current);
    const old = next.resultSyncState;
    const consentRevision=old?.grantHistory?.length??(old?1:0);
    if(request.expectedRevision!==consentRevision) throw new ResultSyncError("result_sync_consent_conflict");
    if (old && old.grant.modelPolicyRevision === request.modelPolicyRevision &&
        old.grant.consentVersion===RESULT_SYNC_CONSENT_VERSION &&
        old.grant.deploymentId === deploymentId && old.grant.ownerId === ownerId &&
        (!request.allowed && old.grant.revokedAt || request.allowed && !old.grant.revokedAt &&
        Date.parse(old.grant.expiresAt) > now.getTime())) return { next: null, result: {...old.grant,consentRevision} };
    const history = old?.grantHistory ?? (old ? [old.grant] : []);
    if (history.length >= 128) throw new ResultSyncError("result_sync_consent_capacity", 429);
    const grant = !request.allowed && old ? {...old.grant, revokedAt:now.toISOString(),
      consentVersion:RESULT_SYNC_CONSENT_VERSION} : {
      scopeId: randomUUID(), deploymentId, ownerId,
      modelPolicyRevision: String(request.modelPolicyRevision), consentVersion: RESULT_SYNC_CONSENT_VERSION,
      grantedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      ...(!request.allowed ? { revokedAt: now.toISOString() } : {}) };
    next.resultSyncState = { grant, grantHistory:[...history, grant],
      receipts: old?.receipts ?? [], revisions: old?.revisions ?? {} };
    next.processingAuthorization!.syncPermission = request.allowed ? { allowed: true, scopeId: grant.scopeId } : { allowed: false };
    return { next, result: {...grant,consentRevision:history.length+1} };
  });
}

export async function readResultSyncConsent(sessionId:string,ownerId:string) {
  const deploymentId=deployment(),session=await findSession(sessionId);
  if(!session) throw new ResultSyncError("session_not_found",404);
  boundSession(session,ownerId,deploymentId);
  const state=session.resultSyncState;
  return {deploymentId,ownerId,modelPolicyRevision:session.processingAuthorization!.modelPolicyRevision,
    consentRevision:state?.grantHistory?.length??(state?1:0)};
}

export function syncSessionResults(sessionId: string, ownerId: string, body: unknown, now = new Date()) {
  const deploymentId = deployment();
  const request = parseResultSync(body);
  const requestHash = resultSyncHash(request);
  return mutate<RealtimeSegmentSyncAck>(sessionId, "result-sync", request, current => {
    boundSession(current, ownerId, deploymentId);
    const state = current.resultSyncState, processing = current.processingAuthorization!;
    if (!state || state.grant.revokedAt || !Number.isFinite(Date.parse(state.grant.expiresAt)) ||
        Date.parse(state.grant.expiresAt) <= now.getTime() || state.grant.consentVersion !== RESULT_SYNC_CONSENT_VERSION ||
        state.grant.ownerId !== ownerId || state.grant.deploymentId !== deploymentId ||
        request.sync.deploymentId !== deploymentId || state.grant.scopeId !== request.sync.scopeId ||
        state.grant.modelPolicyRevision !== request.sync.modelPolicyRevision ||
        processing.modelPolicyRevision !== request.sync.modelPolicyRevision ||
        !processing.syncPermission.allowed || processing.syncPermission.scopeId !== request.sync.scopeId) {
      throw new ResultSyncError("result_sync_permission_denied", 403);
    }
    const previous = state.receipts.find(r => r.opId === request.sync.opId);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ResultSyncError("result_sync_op_conflict");
      return { next: null, result: structuredClone(previous.ack) };
    }
    const tail=withinPublicTailWindow(current,now);
    if ((!tail && !["active", "paused"].includes(current.status)) || (!tail && current.finalizedAt)) {
      throw new ResultSyncError("result_sync_session_terminal");
    }
    if (state.receipts.length >= 512) throw new ResultSyncError("result_sync_receipt_capacity", 429);
    for (const segment of request.segments) {
      if(tail && (current.publicRuntime!.finalRevisions?.[segment.id]!==segment.revision)) {
        throw new ResultSyncError("public_tail_outside_stop_watermark");
      }
      const language = processing.languagePolicy;
      const validDirection = language.autoReverse ? language.pair?.some(code => code === segment.sourceLanguage) &&
        language.pair.some(code => code === segment.targetLanguage) : segment.targetLanguage === language.target &&
        (language.source === "auto" || segment.sourceLanguage === language.source);
      if (!validDirection) throw new ResultSyncError("result_sync_language_mismatch");
      const old = state.revisions[segment.id];
      if (old && (segment.revision! < old.revision || segment.revision === old.revision &&
          resultSyncHash(segment) !== old.contentHash)) throw new ResultSyncError("result_sync_revision_conflict");
      const existing = current.segments.find(s => s.id === segment.id);
      if (existing && (existing.revision ?? 0) > segment.revision!) throw new ResultSyncError("result_sync_revision_conflict");
      if (existing && existing.revision === segment.revision &&
          resultSyncHash(syncTextProjection(existing)) !== resultSyncHash(segment)) {
        throw new ResultSyncError("result_sync_revision_conflict");
      }
    }
    const next = structuredClone(current);
    next.segments = mergeSessionSegments(next.segments, request.segments);
    for (const segment of request.segments) {
      const saved = next.segments.find(s => s.id === segment.id)!;
      if (resultSyncHash(syncTextProjection(saved)) !== resultSyncHash(segment)) {
        throw new ResultSyncError("result_sync_projection_mismatch");
      }
    }
    next.review = null;
    const ack: RealtimeSegmentSyncAck = { operation: "sync", sessionId, deploymentId, ownerId,
      scopeId: request.sync.scopeId, modelPolicyRevision: request.sync.modelPolicyRevision,
      opId: request.sync.opId, acceptedRevisions: request.sync.revisions };
    const nextState = next.resultSyncState as ResultSyncState;
    for (const revision of request.sync.revisions) nextState.revisions[revision.segmentId] = {
      revision: revision.revision, contentHash: revision.contentHash };
    nextState.receipts.push({ opId: request.sync.opId, requestHash, ack });
    // No activity heartbeat, usage update, finalize, model or review generation.
    return { next, result: ack };
  });
}
