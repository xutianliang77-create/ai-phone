import {modelAttemptKey,type PublicModelAttemptEvent,type PublicModelAttemptAck} from "@translation/contracts";
import {assertPublicSession,publicDeploymentId,mutatePublicSession} from "./session-result-sync.service.js";
import {ResultSyncError,syncKey} from "./session-result-sync-contract.js";
import {verifiedPublicAdmission,publicRuntimeAdmissionValid} from "./public-runtime-admission.js";
import {PUBLIC_EVIDENCE_GAP_MS} from "./public-session-lifecycle.js";
export interface PublicModelAttemptRecord {ownerId:string;deploymentId:string;createdAt:string;updatedAt:string;event:PublicModelAttemptEvent;}

function parse(value:unknown,sessionId:string):PublicModelAttemptEvent{
  const e=value as PublicModelAttemptEvent;
  if(!e||Array.isArray(e)||Object.keys(e).some(k=>!["sessionId","leaseId","attemptId","segmentId","revision","component","providerId","modelId","state","failureCode","metadata","audioStartSample","audioEndSample","audioSampleRate"].includes(k))||
    e.sessionId!==sessionId||![e.sessionId,e.leaseId,e.attemptId,e.segmentId,e.providerId,e.modelId].every(syncKey)||
    !Number.isSafeInteger(e.revision)||e.revision<0||!["translation","asr","tts"].includes(e.component)||
    !["dispatching","confirmed","rejected","not_sent","uncertain"].includes(e.state)||
    e.failureCode!==undefined&&!syncKey(e.failureCode))throw new ResultSyncError("invalid_model_attempt",400);
  const m=e.metadata,u=m?.usage;
  if(e.component==="asr"?(!Number.isSafeInteger(e.audioStartSample)||e.audioStartSample!<0||!Number.isSafeInteger(e.audioEndSample)||e.audioEndSample!<=e.audioStartSample!||
    ![16000,24000].includes(e.audioSampleRate!)||e.audioEndSample!-e.audioStartSample!>30*e.audioSampleRate!):
    [e.audioStartSample,e.audioEndSample,e.audioSampleRate].some(v=>v!==undefined))throw new ResultSyncError("invalid_model_attempt",400);
  if(m!==undefined&&(!m||typeof m!=="object"||Array.isArray(m)||Object.keys(m).some(k=>!["requestId","reportedModel","usage"].includes(k))||
    [m.requestId,m.reportedModel].some(v=>v!==undefined&&!syncKey(v))))throw new ResultSyncError("invalid_model_attempt",400);
  if(u!==undefined&&(!u||typeof u!=="object"||Array.isArray(u)||Object.keys(u).some(k=>!["promptTokens","completionTokens","totalTokens","thoughtTokens","cachedPromptTokens","audioInputTokens","textInputTokens","audioSeconds","billedCharacters","audioOutputTokens"].includes(k))||
    Object.entries(u).some(([k,v])=>k==="audioSeconds"?!Number.isFinite(v)||Number(v)<0||Number(v)>3600:!Number.isSafeInteger(v)||Number(v)<0)))throw new ResultSyncError("invalid_model_attempt",400);
  if(e.state==="dispatching"&&(e.metadata!==undefined||e.failureCode!==undefined))throw new ResultSyncError("invalid_model_attempt",400);
  return structuredClone(e);
}
export function recordPublicModelAttempt(sessionId:string,value:unknown,now=new Date()){
  const e=parse(value,sessionId),deployment=publicDeploymentId();
  return mutatePublicSession<PublicModelAttemptAck>(sessionId,"public-model-attempt",e,current=>{
    assertPublicSession(current,current.userId,deployment);
    if(!Number.isFinite(now.getTime())||current.publicRuntimePolicy?.leaseId!==e.leaseId)throw new ResultSyncError("model_attempt_lease_mismatch",403);
    const records=current.publicModelAttempts??[],old=records.find(r=>r.event.attemptId===e.attemptId);
    if(e.state==="dispatching"){
      const admission=verifiedPublicAdmission(current,current.userId,now),p=current.publicRuntimePolicy,r=current.publicRuntime;
      if(!p.admissionHash||!publicRuntimeAdmissionValid(current,now)||current.status!=="active"||r?.phase!=="active"||
        r.uncertain||!Number.isFinite(Date.parse(r.observedAt))||Date.parse(r.observedAt)>now.getTime()||
        now.getTime()-Date.parse(r.observedAt)>PUBLIC_EVIDENCE_GAP_MS||Date.parse(p.expiresAt)<=now.getTime()||
        r.activeMs+now.getTime()-Date.parse(r.observedAt)>p.maxActiveSeconds*1000)throw new ResultSyncError("model_attempt_runtime_unavailable",403);
      if(e.component==="asr"){
        if(e.audioSampleRate!==p.sampleRate||e.audioEndSample!>r.lastAcceptedSample)throw new ResultSyncError("model_attempt_audio_unconfirmed",403);
        if(records.some(a=>a.event.attemptId!==e.attemptId&&a.event.component==="asr"&&a.event.state!=="not_sent"&&
          a.event.audioStartSample!<e.audioEndSample!&&e.audioStartSample!<a.event.audioEndSample!))throw new ResultSyncError("model_attempt_audio_overlap",409);
      }
      const qualification=current.publicInferenceEvidence?.find(r=>r.id===admission.qualificationReceiptIds[e.component]);
      if(e.component==="tts"&&current.processingAuthorization?.executionPlan.tts.execution!=="public")throw new ResultSyncError("model_attempt_tts_disabled",403);
      if(qualification?.kind!=="model_qualification"||qualification.providerId!==e.providerId||qualification.modelId!==e.modelId)throw new ResultSyncError("model_attempt_model_mismatch",403);
      if(e.component==="tts"&&records.some(a=>a.event.attemptId!==e.attemptId&&a.event.component==="tts"&&a.event.segmentId===e.segmentId&&
        a.event.revision===e.revision&&a.event.state!=="not_sent"))throw new ResultSyncError("model_attempt_tts_duplicate",409);
    }
    const ack=(r:PublicModelAttemptRecord):PublicModelAttemptAck=>({event:structuredClone(r.event),recordedAt:r.updatedAt,costStatus:"unknown"});
    if(old){
      if(old.ownerId!==current.userId||old.deploymentId!==deployment||now.getTime()<Date.parse(old.updatedAt))throw new ResultSyncError("model_attempt_scope_conflict",403);
      if(modelAttemptKey(old.event)===modelAttemptKey(e))return {next:null,result:ack(old)};
      // Streaming ASR reserves each growing audio prefix before uploading it.
      // Identity/start/rate stay sealed; completed-file attempts cannot use this.
      if(e.component==="asr"&&e.state==="dispatching"&&old.event.state==="dispatching"&&
        ["openai_realtime_asr","qwen_asr_realtime","tencent_asr_ws","google_speech_v2"].includes(current.publicModelConfiguration?.components.asr?.protocol??"")&&e.audioEndSample!>old.event.audioEndSample!&&
        ["sessionId","leaseId","attemptId","segmentId","revision","component","providerId","modelId","audioStartSample","audioSampleRate"].every(k=>old.event[k as keyof PublicModelAttemptEvent]===e[k as keyof PublicModelAttemptEvent])){
        const next=structuredClone(current),r=next.publicModelAttempts!.find(r=>r.event.attemptId===e.attemptId)!;
        r.event=e;r.updatedAt=now.toISOString();return {next,result:ack(r)};
      }
      if(old.event.state!=="dispatching"||e.state==="dispatching"||
        ["sessionId","leaseId","attemptId","segmentId","revision","component","providerId","modelId","audioStartSample","audioEndSample","audioSampleRate"].some(k=>old.event[k as keyof PublicModelAttemptEvent]!==e[k as keyof PublicModelAttemptEvent])){
        throw new ResultSyncError("model_attempt_conflict");
      }
      // Final metadata may arrive after stop/revocation, but only for this known
      // attempt. It never restarts inference, extends activity or charges a user.
      const next=structuredClone(current),r=next.publicModelAttempts!.find(r=>r.event.attemptId===e.attemptId)!;
      r.event=e;r.updatedAt=now.toISOString();return {next,result:ack(r)};
    }
    if(e.state!=="dispatching")throw new ResultSyncError("model_attempt_not_prepared");
    if(records.length>=1024)throw new ResultSyncError("model_attempt_capacity");
    const r:PublicModelAttemptRecord={ownerId:current.userId,deploymentId:deployment,createdAt:now.toISOString(),updatedAt:now.toISOString(),event:e};
    const next=structuredClone(current);next.publicModelAttempts=[...records,r];return {next,result:ack(r)};
  });
}
