import type {IncomingMessage} from "node:http";
import type WebSocket from "ws";
import type {RealtimeEnv} from "../config/env.js";
import {extractRealtimeConnectionToken} from "../auth/realtime-connection-token.js";
import {verifyRealtimeToken} from "../auth/realtime-token-verifier.js";
import {publicRuntimeTokenBinding} from "@translation/contracts";
import {createSessionEventSink,bindPublicSessionEventSink} from "../sessions/session-event-sink.js";
import {createPublicAdmissionClient} from "../sessions/public-admission-client.js";
import {createPublicRuntimeMaterialClient} from "../sessions/public-runtime-material-client.js";
import {attachSession,getSession,activeSessionCount} from "../sessions/session-manager.js";
import {ProviderRouter} from "../providers/provider-router.js";
import type {ConfiguredPublicSessionOptions} from "../providers/configured-public-session.js";
import {RealtimeTtsOutputQueue} from "../tts/realtime-tts-output.js";
import {abortable} from "../providers/abortable.js";
import {sendRealtimeEvent} from "./realtime-connection-admission.js";
import {buildError} from "../protocol/outgoing-event-builder.js";

export interface PublicGatewayRuntimeOptions {
  credentialAccessSecret:string;apiFetchFn?:typeof fetch;modelFetchFn?:typeof fetch;
  asrSocketFactory?:ConfiguredPublicSessionOptions["socketFactory"];
  ttsSocketFactory?:NonNullable<ConfiguredPublicSessionOptions["output"]>["socketFactory"];
  googleStreamFactory?:ConfiguredPublicSessionOptions["googleStreamFactory"];
}
const pending=new Set<string>();
/** Explicit boot-time path using original Provider, queue, sink and session map.
 * No automatic reconnect: current API admission only permits a fresh created lease.
 * Multi-Gateway exclusive ownership is a separate production gate. */
export async function openConfiguredPublicConnection(env:RealtimeEnv,ws:WebSocket,request:IncomingMessage,options:PublicGatewayRuntimeOptions){
  const token=extractRealtimeConnectionToken(request,false),claims=token?verifyRealtimeToken(token,env.realtimeTokenSecret):null;
  const binding=claims&&env.publicDeploymentId?publicRuntimeTokenBinding(claims,env.publicDeploymentId):null;
  if(!claims||!binding){sendRealtimeEvent(ws,buildError("invalid_token","Invalid public runtime token",{stage:"connection",retryable:false}));ws.close(1008,"invalid_public_token");return null;}
  if(pending.has(claims.sessionId)||getSession(claims.sessionId)||activeSessionCount()+pending.size>=env.maxSessions){ws.close(1008,"public_session_already_attached_or_capacity");return null;}
  pending.add(claims.sessionId);
  const stop=new AbortController(),cancel=()=>stop.abort(),timer=setTimeout(cancel,30000);ws.once("close",cancel);ws.once("error",cancel);
  let built:ReturnType<ProviderRouter["createConfiguredPublicSessionFromVerifiedClaims"]>|undefined;
  try{
    if(!options.credentialAccessSecret||options.credentialAccessSecret.length<32||options.credentialAccessSecret===env.internalApiSecret||options.credentialAccessSecret===env.realtimeTokenSecret)throw Error("public_credential_access_required");
    const sink=createSessionEventSink(env,options.apiFetchFn),admission=createPublicAdmissionClient(sink,claims,env.publicDeploymentId!);
    await abortable(admission.authorize("connect"),stop.signal);
    const material=createPublicRuntimeMaterialClient(sink,claims,env.publicDeploymentId!,options.credentialAccessSecret);
    const {snapshot,authorization}=await material.configuration(stop.signal);
    let started=false;const purpose=()=>started?"dispatch" as const:"connect" as const;
    const scoped={sessionId:claims.sessionId,ownerId:claims.userId,deploymentId:binding.deploymentId,modelPolicyRevision:claims.processing!.modelPolicyRevision,
      leaseId:binding.leaseId,captureId:binding.captureId,languagePolicyKey:binding.languagePolicyKey,sampleRate:binding.sampleRate};
    const sessionInput={sessionId:claims.sessionId,userId:claims.userId,sourceLanguage:claims.sourceLanguage,targetLanguage:claims.targetLanguage,
      voiceOutput:claims.voiceOutput,asrEndpointMode:claims.asrEndpointMode};
    built=new ProviderRouter().createConfiguredPublicSessionFromVerifiedClaims({snapshot,authorization,binding:scoped,session:sessionInput,
      authorizeConnection:async()=>{await admission.authorize(purpose());},resolveAsrCredentials:signal=>material.credentials("asr",purpose(),signal),
      resolveTranslationCredentials:signal=>material.credentials("translation","dispatch",signal),recordAttempt:event=>sink.modelAttempt!(event),
      fetchFn:options.modelFetchFn,socketFactory:options.asrSocketFactory,googleStreamFactory:options.googleStreamFactory,
      ...(claims.voiceOutput?{output:{resolveCredentials:(signal?:AbortSignal)=>material.credentials("tts","dispatch",signal),fetchFn:options.modelFetchFn,
        socketFactory:options.ttsSocketFactory,prefillMs:env.ttsStreamPrefillMs,maxPendingOutputs:env.maxPendingTtsOutputs,isSessionActive:()=>getSession(claims.sessionId)?.status==="active"}}:{})},claims);
    await abortable(built.provider.createSession(sessionInput),stop.signal);
    await abortable(admission.authorize("connect"),stop.signal);
    if(stop.signal.aborted||ws.readyState!==1||getSession(claims.sessionId))throw Error("public_connection_cancelled");
    const attachment=attachSession(claims);if(!attachment||attachment.resumed)throw Error("public_connection_attach_failed");
    const disabledOutput=()=>new RealtimeTtsOutputQueue({sessionId:claims.sessionId,voiceOutput:false,isSessionActive:()=>false,
      synthesizer:{enabled:false,async *synthesizeStream(){throw Error("public_tts_disabled");},cancelSession(){},closeSession(){}}});
    const sessionEventSink=bindPublicSessionEventSink(sink,scoped);
    return {...attachment,provider:built.provider,ttsOutputQueue:built.ttsOutput??disabledOutput(),sessionEventSink,
      checkpointDisconnect:async()=>{await sessionEventSink.disconnect();await sessionEventSink.drain();return admission.inspectRecovery();},
      markStarted:()=>{started=true;},publicConnection:true};
  }catch{
    built?.ttsOutput?.close();if(built)await built.provider.closeSession(claims.sessionId).catch(()=>{});
    sendRealtimeEvent(ws,buildError("provider_unavailable","Public runtime could not be authorized or initialized",{sessionId:claims.sessionId,stage:"provider",retryable:false}));
    if(ws.readyState===1)ws.close(1008,"public_runtime_not_ready");return null;
  }finally{clearTimeout(timer);pending.delete(claims.sessionId);ws.off("close",cancel);ws.off("error",cancel);}
}
