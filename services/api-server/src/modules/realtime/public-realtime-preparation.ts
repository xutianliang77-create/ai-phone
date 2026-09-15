import {publicProtocolAutomaticLanguagePairSupported,publicProtocolCapability,publicProtocolSampleRateSupported,type CreateRealtimeSessionRequest} from "@translation/contracts";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {createSession,findSession} from "../sessions/sessions-runtime.repository.js";
import {assertPublicSession,publicDeploymentId} from "../sessions/session-result-sync.service.js";
import {ResultSyncError,resultSyncHash,syncKey} from "../sessions/session-result-sync-contract.js";
import {withSessionWriteLock} from "../sessions/session-write-coordinator.js";
import type {SessionRecord} from "../sessions/session-record.js";
import {validateCreateRealtimeSessionRequest} from "./create-session-request.js";
import { getRepositoryRuntime } from "../../infrastructure/storage/repository-runtime.js";
import { preparePostgresPublicCreation } from "./postgres-public-creation.repository.js";

export function publicCreationInput(value:unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!["processing","mode","sourceLanguage","targetLanguage",
    "autoReverseTargetLanguage","voiceOutput","voice","termbaseId","domainLexiconPacks","speakerAttribution"].includes(k)))throw new ResultSyncError("public_creation_invalid",400);
  const parsed=validateCreateRealtimeSessionRequest(value);
  if(!parsed.ok)throw new ResultSyncError("public_creation_invalid",400);
  const input=parsed.value,p=input.processing;
  if(!p||p.processingMode!=="online"||
    input.termbaseId||input.domainLexiconPacks?.length||input.speakerAttribution?.mode!=="off"||input.speakerAttribution?.allowVoiceIdentity||
    input.voice&&input.voice.mode!=="preset")throw new ResultSyncError("public_creation_capability_not_supported",503);
  return input;
}
function configuration(input:CreateRealtimeSessionRequest) {
  const config=capturePublicModelRuntimeConfiguration(input.voiceOutput),asr=config.components.asr!,p=input.processing!;
  if(config.deploymentId!==publicDeploymentId()||config.modelPolicyRevision!==p.modelPolicyRevision||
    resultSyncHash(config.executionPlan)!==resultSyncHash(p.executionPlan))throw new ResultSyncError("public_creation_configuration_changed");
  if(publicProtocolCapability(asr.protocol)?.input!=="continuous_pcm"||!publicProtocolSampleRateSupported(asr.protocol,asr.sampleRate))throw new ResultSyncError("public_creation_asr_not_continuous",503);
  const automatic=p.languagePolicy.source==="auto"||p.languagePolicy.autoReverse;
  const pair=p.languagePolicy.pair;
  // The selected pair is part of the original settings contract. The adapter
  // may expose automatic language only when this exact pair has separately
  // passed signed policy/live qualification; fixed-engine ASR stays rejected.
  if(automatic&&(!publicProtocolAutomaticLanguagePairSupported(asr.protocol,pair)||p.languagePolicy.source!=="auto"||
    !pair||!pair.includes(p.languagePolicy.target))) {
    throw new ResultSyncError("public_creation_automatic_language_not_supported",503);
  }
  if(input.voice&&(!input.voiceOutput||input.voice.mode!=="preset"||input.voice.presetId!==config.components.tts?.voice||input.voice.quality!=="standard"||Object.keys(input.voice).some(k=>!["mode","presetId","quality"].includes(k))))throw new ResultSyncError("public_creation_voice_mismatch",400);
  return config;
}
export function preparedPublicSession(current:SessionRecord,ownerId:string) {
  assertPublicSession(current,ownerId,publicDeploymentId());
  if(current.publicCreationRetirement)throw new ResultSyncError("public_creation_request_retired",410);
  if(current.status!=="created"||current.publicRuntime||current.publicFinalization||current.finalizedAt||current.finalizationIdempotencyKey)throw new ResultSyncError("public_creation_sealed");
  const prepared=current.publicCreationRequest;
  if(!prepared||prepared.requestHash!==resultSyncHash(prepared.request))throw new ResultSyncError("public_creation_not_prepared",503);
  const input=publicCreationInput(prepared.request),config=configuration(input),p=input.processing!,auth=current.processingAuthorization!;
  if(current.mode!==input.mode||auth.modelPolicyRevision!==config.modelPolicyRevision||resultSyncHash(auth.executionPlan)!==resultSyncHash(config.executionPlan)||resultSyncHash(config)!==resultSyncHash(current.publicModelConfiguration)||
    resultSyncHash(p.languagePolicy)!==resultSyncHash(auth.languagePolicy)||auth.syncPermission.allowed)throw new ResultSyncError("public_creation_binding_changed");
  return {input,config};
}

/** Internal phase on the original session repository. The trusted coordinator
 * allocates/reuses sessionId; an HTTP client may not select another session/owner.
 * Returns preparation metadata only: no token, hold, evidence, grant or model call. */
export function preparePublicRealtimeSession(sessionId:string,ownerId:string,value:unknown,now=new Date()) {
  const input=publicCreationInput(value);
  if(![sessionId,ownerId].every(syncKey)||!Number.isFinite(now.getTime()))throw new ResultSyncError("public_creation_invalid",400);
  return withSessionWriteLock(sessionId,async()=>{
    const config=configuration(input),requestHash=resultSyncHash(input),existing=await findSession(sessionId);
    if(existing){
      if(existing.publicCreationRetirement)throw new ResultSyncError("public_creation_request_retired",410);
      const prepared=preparedPublicSession(existing,ownerId);
      if(existing.publicCreationRequest!.requestHash!==requestHash)throw new ResultSyncError("public_creation_request_conflict");
      return {sessionId,status:"prepared_not_admitted" as const,configuration:prepared.config};
    }
    // Configuration may rotate while repository reads await; do not bind a stale snapshot.
    if(resultSyncHash(configuration(input))!==resultSyncHash(config))throw new ResultSyncError("public_creation_configuration_changed");
    const p=input.processing!;
    const record={id:sessionId,userId:ownerId,mode:input.mode,status:"created" as const,createdAt:now.toISOString(),consumedSeconds:0,segments:[],
      processingDeploymentId:config.deploymentId,publicModelConfiguration:config,publicCreationRequest:{requestHash,request:input},
      processingAuthorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:p.modelPolicyRevision,languagePolicy:p.languagePolicy,
        executionPlan:p.executionPlan,syncPermission:{allowed:false}}} satisfies SessionRecord;
    if(getRepositoryRuntime().driver==="postgres")await preparePostgresPublicCreation(record);
    else await createSession(record);
    return {sessionId,status:"prepared_not_admitted" as const,configuration:config};
  });
}
