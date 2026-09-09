import {preparePublicRealtimeSession,publicCreationInput,preparedPublicSession} from "./public-realtime-preparation.js";
import {issuePublicRealtimeSession} from "./public-realtime-issuer.js";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {publicCreationIdentity} from "./public-creation-binding.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import {withSessionWriteLock} from "../sessions/session-write-coordinator.js";
import {ResultSyncError,resultSyncHash} from "../sessions/session-result-sync-contract.js";
import {inferenceProcessingHash,validateInferenceEvidence,resolveInferenceEvidence,type PublicInferenceEvidence,type InferenceEvidenceRefs} from "../sessions/public-inference-evidence.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission} from "../sessions/public-inference-admission.service.js";
import type {PublicModelRuntimeSnapshot} from "../models/public-model-runtime-config.js";
import {getRepositoryRuntime} from "../../infrastructure/storage/repository-runtime.js";

/** Trusted boot-time integration only. Production must resolve durable, independently
 * verified receipts idempotently for sessionId; neither HTTP body nor config can
 * supply this implementation. No real supplier/consent/budget source is installed by default. */
export interface PublicRealtimeAuthority {
  timeoutMs:number;
  resolveVerifiedEvidence(context:{sessionId:string;ownerId:string;deploymentId:string;processingHash:string;configuration:PublicModelRuntimeSnapshot},
    signal:AbortSignal):Promise<{records:PublicInferenceEvidence[];refs:InferenceEvidenceRefs}>;
}
export type PublicRealtimeCoordinator=ReturnType<typeof createPublicRealtimeCoordinator>;
async function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  let cancel=()=>{};const aborted=new Promise<never>((_,reject)=>{cancel=()=>reject(new ResultSyncError("public_creation_cancelled",503));
    if(signal.aborted)cancel();else signal.addEventListener("abort",cancel,{once:true});});
  try{return await Promise.race([work,aborted]);}finally{signal.removeEventListener("abort",cancel);}
}
export function createPublicRealtimeCoordinator(authority:PublicRealtimeAuthority){
  const {timeoutMs,resolveVerifiedEvidence}=authority;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>30000||typeof resolveVerifiedEvidence!=="function")throw Error("public_authority_configuration_invalid");
  return async(ownerId:string,idempotencyKey:unknown,value:unknown,signal?:AbortSignal)=>{
    if(getRepositoryRuntime().driver==="postgres")throw new ResultSyncError("public_creation_postgres_idempotency_not_ready",503);
    const {deploymentId,sessionId}=publicCreationIdentity(ownerId,idempotencyKey),input=publicCreationInput(value);
    // Stable across restarts/signing-key rotation, scoped by deployment AND account.
    // Knowing this ID does not grant access; all original owner checks remain.
    const stop=new AbortController(),cancel=()=>stop.abort();signal?.addEventListener("abort",cancel,{once:true});
    if(signal?.aborted)cancel();const timer=setTimeout(cancel,timeoutMs);
    const check=()=>{if(stop.signal.aborted)throw new ResultSyncError("public_creation_cancelled",503);};
    try{return await bounded(withSessionWriteLock(`public-create:${sessionId}`,async()=>{
      check();
      if(/^(cancelled|expired):/.test(getStoreSnapshot().publicCreationBindings?.[sessionId]??""))throw new ResultSyncError("public_creation_request_retired",410);
      await preparePublicRealtimeSession(sessionId,ownerId,input);check();
      let current=(await findSession(sessionId))!;check();
      if(!current.publicInferenceAdmission){
        const {config}=preparedPublicSession(current,ownerId);
        const context={sessionId,ownerId,deploymentId,processingHash:inferenceProcessingHash(current),configuration:config};
        let resolved:Awaited<ReturnType<PublicRealtimeAuthority["resolveVerifiedEvidence"]>>;
        try{resolved=await bounded(Promise.resolve().then(()=>{check();return resolveVerifiedEvidence(structuredClone(context),stop.signal);}),stop.signal);}
        catch{check();throw new ResultSyncError("public_creation_authority_unavailable",503);}
        check();current=(await findSession(sessionId))!;check();preparedPublicSession(current,ownerId);
        if(!resolved||!Array.isArray(resolved.records)||resolved.records.length>32||new Set(resolved.records.map(r=>r?.id)).size!==resolved.records.length)throw new ResultSyncError("public_evidence_invalid",403);
        const records=structuredClone(resolved.records),refs=structuredClone(resolved.refs),now=new Date();
        // Validate the complete selection BEFORE partially persisting it.
        for(const record of records)validateInferenceEvidence(current,record,now);
        const prospective=structuredClone(current);prospective.publicInferenceEvidence=[...(current.publicInferenceEvidence??[])];
        for(const record of records){const old=prospective.publicInferenceEvidence.find(e=>e.id===record.id);
          if(old&&resultSyncHash(old)!==resultSyncHash(record))throw new ResultSyncError("public_evidence_conflict");if(!old)prospective.publicInferenceEvidence.push(record);}
        if(prospective.publicInferenceEvidence.length>32)throw new ResultSyncError("public_evidence_capacity",409);
        resolveInferenceEvidence(prospective,refs,now);
        for(const record of records){check();await recordPublicInferenceEvidence(sessionId,ownerId,record);}
        check();await writePublicInferenceAdmission(sessionId,ownerId,refs);
      }
      check();const response=await issuePublicRealtimeSession(sessionId,ownerId);check();return response;
    }),stop.signal);}finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel);}
  };
}
