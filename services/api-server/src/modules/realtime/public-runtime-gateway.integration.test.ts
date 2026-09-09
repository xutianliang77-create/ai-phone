import {beforeEach,afterEach,it,expect,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../../app.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import * as storage from "../../infrastructure/storage/json-store.js";
import {createUsageHold} from "../usage/usage.service.js";
import type {SessionRecord} from "../sessions/session-record.js";
import {issuePublicRuntimeLease,publicProcessingHash} from "../sessions/public-runtime-admission.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission} from "../sessions/public-inference-admission.service.js";
import {LmStudioClient} from "../../../../realtime-gateway/src/providers/lmstudio/lmstudio-client.js";
import {LmStudioRealtimeProvider} from "../../../../realtime-gateway/src/providers/lmstudio/lmstudio-realtime-provider.js";
import {recordPublicModelAttempt} from "../sessions/public-model-attempt.service.js";
import {createSessionEventSink,bindPublicSessionEventSink} from "../../../../realtime-gateway/src/sessions/session-event-sink.js";
import type {RealtimeEnv} from "../../../../realtime-gateway/src/config/env.js";
import {RealtimeEventDispatcher} from "../../../../realtime-gateway/src/connection/realtime-event-dispatcher.js";
import {RealtimeSessionFinalizer} from "../../../../realtime-gateway/src/connection/realtime-session-finalizer.js";
import {RealtimeFlushTracker} from "../../../../realtime-gateway/src/connection/realtime-flush-tracker.js";
import {createSession,deleteSession,transitionStatus} from "../../../../realtime-gateway/src/sessions/session-manager.js";
import type {RealtimeProvider} from "../../../../realtime-gateway/src/providers/realtime-provider.js";
import {AudioFrameBatcher} from "../../../../realtime-gateway/src/connection/audio-frame-batcher.js";
import {handleAudioBoundary} from "../../../../realtime-gateway/src/connection/audio-boundary-control.js";
import {handleControlEvent} from "../../../../realtime-gateway/src/connection/session-control-handler.js";
const start=Date.parse("2026-09-08T00:00:00Z"),id="public-producer-test";
const binding={sessionId:id,ownerId:"guest-user",deploymentId:"public-test",modelPolicyRevision:"policy-v1",
  leaseId:"lease",captureId:"capture",languagePolicyKey:"policy:1",sampleRate:16000 as const};
const env={sessionEventSink:"api",apiBaseUrl:"https://synthetic-api.test",internalApiSecret:"internal-test-secret-123",sessionSyncTimeoutMs:1000} as RealtimeEnv;
const clock=(seconds:number)=>vi.setSystemTime(start+seconds*1000);
const current=()=>getStoreSnapshot().sessions.find(s=>s.id===id)!;
let app:FastifyInstance;
let calls:Array<{url:string;body:Record<string,unknown>}>;
let corruptStop=false;
let loseStopReply=false;
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});clock(0);corruptStop=false;loseStopReply=false;calls=[];
  vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");vi.stubEnv("INTERNAL_API_SECRET",env.internalApiSecret!);
  vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");
  const s=getStoreSnapshot();s.sessions=[record()];s.billingLedger=[];s.usageHolds=[];s.usageBalances={};s.usagePlanCodes={};
  const prepared=current(),common={sessionId:id,ownerId:"guest-user",deploymentId:"public-test",processingHash:publicProcessingHash(prepared),
    region:"synthetic-region",providerPolicyRevision:"synthetic-policy",sourceReceiptId:"synthetic-source",
    issuedAt:new Date(start).toISOString(),expiresAt:new Date(start+3600000).toISOString()};
  await recordPublicInferenceEvidence(id,"guest-user",{...common,id:"synthetic-consent",kind:"inference_consent",version:"public-inference-v1",components:["asr","translation"]});
  await recordPublicInferenceEvidence(id,"guest-user",{...common,id:"synthetic-budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,maxActiveSeconds:120,sampleRate:16000});
  for(const component of ["asr","translation"] as const)await recordPublicInferenceEvidence(id,"guest-user",{...common,id:`synthetic-${component}`,kind:"model_qualification",state:"qualified",component,
    scopeKey:prepared.processingAuthorization!.executionPlan[component].scopeKey,providerId:"synthetic-provider",modelId:`synthetic-${component}`});
  await writePublicInferenceAdmission(id,"guest-user",{consentReceiptId:"synthetic-consent",budgetReservationId:"synthetic-budget",qualificationReceiptIds:{asr:"synthetic-asr",translation:"synthetic-translation"}});
  const lease=await issuePublicRuntimeLease(id,"guest-user");
  Object.assign(binding,{leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey});
  createUsageHold("guest-user",120,undefined,{sessionId:id,idempotencyKey:`hold:${id}`});app=await buildApp();
  vi.stubGlobal("fetch",vi.fn(async(input:unknown,init:RequestInit)=>{
    const url=new URL(String(input));expect(url.origin).toBe("https://synthetic-api.test");
    const body=JSON.parse(String(init.body));calls.push({url:url.pathname,body});
    const response=await app.inject({method:"POST",url:url.pathname,headers:init.headers as Record<string,string>,payload:body});
    if(loseStopReply&&body.phase==="stopped"){loseStopReply=false;clock(20);throw Error("Synthetic lost response after commit");}
    const result=response.json();if(corruptStop&&body.phase==="stopped")result.ownerId="wrong-owner";
    return new Response(JSON.stringify(result),{status:response.statusCode});
  }));
});
afterEach(async()=>{deleteSession(id);await app.close();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();vi.restoreAllMocks();});

it("runs original dispatcher/finalizer through the public sink into real API handlers and one settlement",async()=>{
  const sink=bindPublicSessionEventSink(createSessionEventSink(env),binding);
  createSession({sessionId:id,userId:"guest-user",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,
    planCode:"free",maxDurationSeconds:120,issuedAt:0,expiresAt:9999999999});
  const errors:unknown[]=[],client:unknown[]=[];
  const tracker=new RealtimeFlushTracker();
  const dispatcher=new RealtimeEventDispatcher({eventSink:sink,sendClient:e=>client.push(e),afterSend:e=>tracker.record(e),onSyncError:(_e,error)=>errors.push(error)});
  const drain=async()=>{await dispatcher.drain();await sink.drain();};
  dispatcher.send({type:"session.started",sessionId:id});await drain();
  sink.acceptAudio({type:"audio.frame",sessionId:id,sequence:1,timestampMs:999999,format:"pcm16",sampleRate:16000,data:Buffer.alloc(320).toString("base64")});
  clock(10);dispatcher.send({type:"transcript.final",sessionId:id,segmentId:"seg",text:"你好",language:"zh",revision:1});
  transitionStatus(id,"paused");dispatcher.send({type:"session.paused",sessionId:id});await drain();
  clock(70);transitionStatus(id,"active");dispatcher.send({type:"session.resumed",sessionId:id});await drain();clock(75);
  const provider={name:"synthetic-no-network",async *flushSession(){yield {type:"translation.final" as const,sessionId:id,
    segmentId:"seg",text:"Hello",language:"en" as const,revision:2};},closeSession:vi.fn(async()=>{})} as unknown as RealtimeProvider;
  const finalizer=new RealtimeSessionFinalizer({sessionId:id,provider,flushTracker:tracker,
    audioBatcher:{stopAccepting:vi.fn(),flush:async()=>{}},send:dispatcher.send,drainSessionSync:drain,onError:(_s,e)=>errors.push(e)});
  await Promise.all([finalizer.finalize("user_request"),finalizer.finalize("user_request")]);
  expect(errors).toEqual([]);expect(current()).toMatchObject({status:"ended",consumedSeconds:15});
  expect(current().segments[0]).toMatchObject({id:"seg",sourceText:"你好",translatedText:"Hello",revision:2});
  expect(current().publicFinalization?.ack.stopWatermark).toMatchObject({finalRevision:2,lastAcceptedSample:160});
  expect(getStoreSnapshot().billingLedger.filter(l=>l.idempotencyKey===`settle:${id}`)).toHaveLength(1);
  expect(calls.filter(c=>c.url.endsWith("/state")||c.url.endsWith("/end"))).toEqual([]);
  expect(calls.filter(c=>c.url.endsWith("/runtime")).map(c=>c.body.sequence)).toEqual([1,2,3,4]);
  expect(client).toContainEqual(expect.objectContaining({type:"session.ended"}));
});
it("retains an unconfirmed stop when its response is wrong even though server settlement exists",async()=>{
  const sink=bindPublicSessionEventSink(createSessionEventSink(env),binding);await sink.record({type:"session.started",sessionId:id});
  clock(8);corruptStop=true;
  await expect(sink.record({type:"session.ended",sessionId:id,reason:"user_request",billableSeconds:0})).rejects.toThrow("unconfirmed");
  await expect(sink.drain()).rejects.toThrow();
  expect(current().consumedSeconds).toBe(8);expect(getStoreSnapshot().billingLedger).toHaveLength(1);
  const recovery=await app.inject({method:"GET",url:`/realtime/sessions/${id}/recovery`});
  expect(recovery.json().finalization).toMatchObject({consumedSeconds:8,ownerId:"guest-user"});
  expect(calls.filter(c=>c.body.phase==="stopped")).toHaveLength(1);
});
it("retries the exact stop after lost acknowledgement without extending metering or settling twice",async()=>{
  const sink=bindPublicSessionEventSink(createSessionEventSink(env),binding);await sink.record({type:"session.started",sessionId:id});
  clock(8);loseStopReply=true;await sink.record({type:"session.ended",sessionId:id,reason:"user_request"});
  expect(current().consumedSeconds).toBe(8);expect(current().endedAt).toBe(new Date(start+8000).toISOString());
  expect(getStoreSnapshot().billingLedger).toHaveLength(1);
  const stops=calls.filter(c=>c.body.phase==="stopped");expect(stops).toHaveLength(2);expect(stops[0]).toEqual(stops[1]);
});
function record():SessionRecord{return {id,userId:"guest-user",mode:"conversation",status:"created",consumedSeconds:0,
  createdAt:new Date(start).toISOString(),segments:[],processingDeploymentId:"public-test",
  processingAuthorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy-v1",publicGrantRef:"integration-grant",
    languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false},executionPlan:{
      asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}}}};}

async function modelClient(fetchFn:typeof fetch,recordOverride?: (event:any)=>Promise<void>){
  const transport=createSessionEventSink(env);const sink=bindPublicSessionEventSink(transport,binding);
  await sink.record({type:"session.started",sessionId:id});
  const client=new LmStudioClient({baseUrl:"https://synthetic-model.test/v1",model:"synthetic-translation",apiKey:"synthetic-key",timeoutMs:10000,
    transportProfile:"public_compatible",fetchFn,attemptRecorder:{sessionId:id,leaseId:binding.leaseId,providerId:"synthetic-provider",record:recordOverride??transport.modelAttempt!.bind(transport)}});
  return {client,sink};
}
const mtInput={text:"这是仅发给模型的测试原文",sourceLanguage:"zh",targetLanguage:"en",attemptContext:{segmentId:"mt-seg",revision:1}};
const mtResponse=()=>new Response(JSON.stringify({id:"request-id",model:"synthetic-translation",usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13},choices:[{finish_reason:"stop",message:{content:"translated result"}}]}));
it("persists dispatch intent before model send, then usage without changing activity or customer billing",async()=>{
  const modelFetch=vi.fn(async()=>{expect(current().publicModelAttempts?.[0].event.state).toBe("dispatching");return mtResponse();});
  const {client}=await modelClient(modelFetch);const activity=current().lastActivityAt;
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic-model.test/v1",model:"synthetic-translation",timeoutMs:10000,translationClient:client});
  await provider.createSession({sessionId:id,sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false});
  const output=[];for await(const event of provider.sendText({sessionId:id,segmentId:"mt-seg",revision:1,text:mtInput.text,language:"zh",isFinal:true,finalizeImmediately:true}))output.push(event);
  await provider.closeSession(id);expect(output.some(e=>e.type==="translation.final")).toBe(true);
  const r=current().publicModelAttempts![0];
  expect(r.event).toMatchObject({state:"confirmed",segmentId:"mt-seg",revision:1,metadata:{usage:{promptTokens:10,totalTokens:13}}});
  expect(JSON.stringify(current().publicModelAttempts)).not.toContain(mtInput.text);
  expect(current().lastActivityAt).toBe(activity);expect(current().consumedSeconds).toBe(0);expect(getStoreSnapshot().billingLedger).toEqual([]);
  const before=structuredClone(current());const ack=await recordPublicModelAttempt(id,r.event);
  expect(ack.costStatus).toBe("unknown");expect(current()).toEqual(before);expect(modelFetch).toHaveBeenCalledTimes(1);
  await expect(recordPublicModelAttempt(id,{...r.event,metadata:{usage:{totalTokens:0}}})).rejects.toThrow("conflict");
});
it("does not send a model request if its dispatch record cannot be confirmed",async()=>{
  const modelFetch=vi.fn(async()=>mtResponse());const {client}=await modelClient(modelFetch,async()=>{throw Error("storage unavailable");});
  await expect(client.translate(mtInput)).rejects.toMatchObject({code:"public_attempt_record_failed",outcome:"not_sent"});
  expect(modelFetch).not.toHaveBeenCalled();expect(current().publicModelAttempts).toBeUndefined();
});
it("retains dispatch uncertainty if the final usage record fails and does not return success",async()=>{
  const transport=createSessionEventSink(env);let n=0;const modelFetch=vi.fn(async()=>mtResponse());
  const {client}=await modelClient(modelFetch,async e=>{if(++n===2)throw Error("final storage unavailable");await transport.modelAttempt!(e);});
  await expect(client.translate(mtInput)).rejects.toMatchObject({code:"public_attempt_record_failed",outcome:"uncertain"});
  expect(current().publicModelAttempts![0].event.state).toBe("dispatching");expect(modelFetch).toHaveBeenCalledTimes(1);
  current().publicInferenceAdmission!.revokedAt=new Date(start).toISOString();
  await expect(recordPublicModelAttempt(id,current().publicModelAttempts![0].event)).rejects.toThrow("admission_required");
});
it("records cancellation after send as uncertain without a fake zero usage",async()=>{
  let began!:()=>void;const started=new Promise<void>(r=>{began=r;});
  const modelFetch=vi.fn(async()=>{began();return new Response(new ReadableStream({}));});
  const {client}=await modelClient(modelFetch);const abort=new AbortController();
  const result=client.translate({...mtInput,signal:abort.signal});const rejected=expect(result).rejects.toMatchObject({outcome:"uncertain"});
  await started;abort.abort();await rejected;
  expect(current().publicModelAttempts![0].event).toMatchObject({state:"uncertain",failureCode:"public_translation_cancelled"});
  expect(current().publicModelAttempts![0].event.metadata?.usage).toBeUndefined();expect(getStoreSnapshot().billingLedger).toEqual([]);
});
it("only accepts terminal metadata for an existing attempt after stop, with internal auth and strict fields",async()=>{
  const {client,sink}=await modelClient(async()=>mtResponse());await client.translate(mtInput);
  const event=current().publicModelAttempts![0].event;await sink.record({type:"session.ended",sessionId:id,reason:"client_request"});
  const before=structuredClone(getStoreSnapshot());
  const unauth=await app.inject({method:"POST",url:`/internal/realtime/sessions/${id}/model-attempts`,payload:event});expect(unauth.statusCode).toBe(401);
  for(const patch of [{billableSeconds:0},{text:"raw"},{costMicros:0},{metadata:{usage:{totalTokens:-1}}}]){
    expect(()=>recordPublicModelAttempt(id,{...event,...patch})).toThrow("invalid_model_attempt");
  }
  await expect(recordPublicModelAttempt(id,{...event,attemptId:"unknown"})).rejects.toThrow("not_prepared");
  await expect(recordPublicModelAttempt(id,{...event,state:"dispatching",attemptId:"new",metadata:undefined})).rejects.toThrow("unavailable");
  expect(getStoreSnapshot()).toEqual(before);
});
it("records an HTTP rejection once without assuming zero supplier cost",async()=>{
  const modelFetch=vi.fn(async()=>new Response('{"error":{"message":"sensitive"}}',{status:429}));
  const {client}=await modelClient(modelFetch);await expect(client.translate(mtInput)).rejects.toMatchObject({status:429});
  const event=current().publicModelAttempts![0].event;expect(event.state).toBe("rejected");
  expect((await recordPublicModelAttempt(id,event)).costStatus).toBe("unknown");expect(modelFetch).toHaveBeenCalledTimes(1);
});
it("saves known late completion metadata after stop without extending or rebilling the session",async()=>{
  let began!:()=>void,finish!:(r:Response)=>void;const started=new Promise<void>(r=>{began=r;});
  const modelFetch=vi.fn(()=>{began();return new Promise<Response>(r=>{finish=r;});});
  const {client,sink}=await modelClient(modelFetch);const pending=client.translate(mtInput);await started;
  await sink.record({type:"session.ended",sessionId:id,reason:"client_request"});
  const ledger=structuredClone(getStoreSnapshot().billingLedger),activity=current().lastActivityAt;
  finish(mtResponse());await pending;
  expect(current().publicModelAttempts![0].event.state).toBe("confirmed");expect(current().status).toBe("ended");
  expect(current().lastActivityAt).toBe(activity);expect(getStoreSnapshot().billingLedger).toEqual(ledger);
});
it("rolls back failed attempt persistence atomically",async()=>{
  const {client}=await modelClient(async()=>mtResponse());await client.translate(mtInput);
  const event={...current().publicModelAttempts![0].event,attemptId:"rollback-attempt",state:"dispatching",metadata:undefined};
  const before=structuredClone(getStoreSnapshot());
  vi.spyOn(storage,"persistStoreSnapshot").mockImplementationOnce(()=>{throw Error("disk failure");});
  await expect(recordPublicModelAttempt(id,event)).rejects.toThrow("disk failure");expect(getStoreSnapshot()).toEqual(before);
});
it.each([false,true])("runs public boundary/pause/finalize against real API handlers with resume=%s",async resume=>{
  const sink=bindPublicSessionEventSink(createSessionEventSink(env),binding),clientEvents:any[]=[],errors:unknown[]=[];
  createSession({sessionId:id,userId:"guest-user",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,planCode:"free",maxDurationSeconds:120,issuedAt:0,expiresAt:9999999999});
  const tracker=new RealtimeFlushTracker(),dispatcher=new RealtimeEventDispatcher({eventSink:sink,sendClient:e=>clientEvents.push(e),afterSend:e=>tracker.record(e),onSyncError:(_e,error)=>errors.push(error)});
  const drain=()=>dispatcher.drain(),confirm=()=>sink.confirmAudio();dispatcher.send({type:"session.started",sessionId:id});await drain();
  dispatcher.send({type:"transcript.partial",sessionId:id,segmentId:"boundary-seg",text:"你",language:"zh",revision:0});await drain();expect(current().segments).toHaveLength(0);
  let pending=false;
  const provider:RealtimeProvider={name:"synthetic-endpoint",createSession:async()=>{},closeSession:vi.fn(async()=>{}),healthCheck:async()=>false,
    async *sendAudio(){pending=true;},async *flushSession(){if(!pending)return;expect(current().status).toBe("active");pending=false;
      yield {type:"transcript.final",sessionId:id,segmentId:"boundary-seg",text:"你好",language:"zh",revision:1};
      yield {type:"translation.final",sessionId:id,segmentId:"boundary-seg",text:"Hello",language:"en",revision:2};}};
  const batcher=new AudioFrameBatcher({sessionId:id,provider,send:dispatcher.send,onError:e=>errors.push(e),acceptFrame:f=>sink.acceptAudio(f),beforeSend:confirm,batchDelayMs:10000});
  clock(1);batcher.enqueue({type:"audio.frame",sessionId:id,sequence:1,timestampMs:start+1000,format:"pcm16",sampleRate:16000,data:Buffer.alloc(32000).toString("base64")});
  await handleAudioBoundary({type:"audio.boundary",sessionId:id,sequence:1},{sessionId:id,confirmed:true,batcher,provider,beforeFlush:confirm,drain,send:dispatcher.send});await drain();
  expect(current().segments[0]).toMatchObject({sourceText:"你好",translatedText:"Hello"});expect(current().publicRuntime?.lastAcceptedSample).toBe(16000);
  expect(clientEvents).toContainEqual(expect.objectContaining({type:"audio.boundary.committed",sequence:1}));
  const controls={beforeFlush:confirm,drain};clock(2);
  await handleControlEvent({type:"session.pause",sessionId:id},id,provider,batcher,dispatcher.send,async()=>{},undefined,controls);
  expect(current().status).toBe("paused");const pausedMs=current().publicRuntime?.activeMs;clock(10);await confirm();expect(current().publicRuntime?.activeMs).toBe(pausedMs);
  if(resume){await handleControlEvent({type:"session.resume",sessionId:id},id,provider,batcher,dispatcher.send,async()=>{},undefined,controls);clock(11);}
  const finalizer=new RealtimeSessionFinalizer({sessionId:id,provider,audioBatcher:batcher,send:dispatcher.send,drainSessionSync:drain,flushTracker:tracker,onError:(_s,e)=>errors.push(e),confirmed:{beforeFlush:confirm}});
  await Promise.all([finalizer.finalize("user_request"),finalizer.finalize("user_request")]);
  expect(errors).toEqual([]);expect(current()).toMatchObject({status:"ended",consumedSeconds:resume?3:2});
  expect(getStoreSnapshot().billingLedger.filter(row=>row.idempotencyKey===`settle:${id}`)).toHaveLength(1);expect(provider.closeSession).toHaveBeenCalledTimes(1);
});
