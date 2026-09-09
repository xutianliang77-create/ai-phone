import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {generateKeyPairSync} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as storage from "../../infrastructure/storage/json-store.js";
import {emptyConfiguration,publicModelCatalog} from "../models/public-model-config.js";
import {savePublicModelConfiguration,readPublicModelConfiguration} from "../models/public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration,resolvePublicModelRuntimeCredentials} from "../models/public-model-runtime-config.js";
import {bindPublicModelConfiguration} from "./public-model-configuration.service.js";
import {inferenceProcessingHash,type PublicInferenceEvidence} from "./public-inference-evidence.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission} from "./public-inference-admission.service.js";
import {issuePublicRuntimeLease,verifiedPublicAdmission} from "./public-runtime-admission.js";
import {SyntheticAsrSocket} from "../../../../realtime-gateway/src/asr/streaming-asr.test-support.js";
import {LmStudioRealtimeProvider} from "../../../../realtime-gateway/src/providers/lmstudio/lmstudio-realtime-provider.js";
import {markAcceptedAudioRange} from "../../../../realtime-gateway/src/connection/accepted-audio-range.js";
import type {SessionRecord} from "./session-record.js";
import {ProviderRouter} from "../../../../realtime-gateway/src/providers/provider-router.js";
import {recordPublicModelAttempt} from "./public-model-attempt.service.js";
import {observePublicRuntime} from "./public-session-runtime.service.js";
import {createPublicModelCredentialResolver} from "../models/public-model-credential-resolver.js";
import {createConfiguredPublicTtsOutputQueue} from "../../../../realtime-gateway/src/tts/realtime-tts-output-factory.js";
import {buildApp} from "../../app.js";
import {createUsageHold} from "../usage/usage.service.js";
import {createSessionEventSink,bindPublicSessionEventSink} from "../../../../realtime-gateway/src/sessions/session-event-sink.js";
import {RealtimeEventDispatcher} from "../../../../realtime-gateway/src/connection/realtime-event-dispatcher.js";
import {RealtimeSessionFinalizer} from "../../../../realtime-gateway/src/connection/realtime-session-finalizer.js";
import {RealtimeFlushTracker} from "../../../../realtime-gateway/src/connection/realtime-flush-tracker.js";
import {AudioFrameBatcher} from "../../../../realtime-gateway/src/connection/audio-frame-batcher.js";
import {handleAudioBoundary} from "../../../../realtime-gateway/src/connection/audio-boundary-control.js";
import {handleControlEvent} from "../../../../realtime-gateway/src/connection/session-control-handler.js";
import {createSession,deleteSession,getSession} from "../../../../realtime-gateway/src/sessions/session-manager.js";
import type {RealtimeEnv} from "../../../../realtime-gateway/src/config/env.js";
import {SyntheticQwenSpeechSocket} from "../../../../realtime-gateway/src/tts/qwen-speech.test-support.js";
import {SyntheticTencentSpeechSocket} from "../../../../realtime-gateway/src/tts/tencent-speech.test-support.js";
import {pcm16Wav} from "../../../../realtime-gateway/src/speaker/recent-pcm-audio-buffer.js";
import {SyntheticQwenAsrSocket} from "../../../../realtime-gateway/src/asr/qwen-streaming-asr.test-support.js";
import {SyntheticTencentAsrSocket} from "../../../../realtime-gateway/src/asr/tencent-streaming-asr.test-support.js";
import {SyntheticGoogleAsrStream} from "../../../../realtime-gateway/src/asr/google-streaming-asr.test-support.js";
import type {GoogleAsrStreamFactory} from "../../../../realtime-gateway/src/asr/google-streaming-asr.js";

import {dir,now,secret,current,body,session,bind,evidence,installConfigurationFixture} from "./public-model-configuration.test-support.js";
installConfigurationFixture();
describe("original configured public model joint journeys",()=>{
  it.each(["normal","cancel_tts","tts_failure","sync_failure","qwen","tencent","google_sa","google_adc","qwen_asr","tencent_asr","asr_google_sa","asr_google_adc"])("joint original ASR/MT/TTS journey with %s",async scenario=>{
    const google=scenario.startsWith("google_");
    const googleAsr=scenario.startsWith("asr_google_");
    const normal=["normal","qwen","tencent","qwen_asr","tencent_asr"].includes(scenario)||google||googleAsr;
    const asrRate=["qwen_asr","tencent_asr"].includes(scenario)||googleAsr?16000:24000;
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
    vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");vi.stubEnv("INTERNAL_API_SECRET","synthetic-joint-secret");
    const update=body(1);
    Object.assign(update.components.asr,{vendor:"openai",protocol:"openai_realtime_asr",endpoint:"wss://synthetic.invalid/v1/realtime",sampleRate:24000});
    if(scenario==="qwen_asr")Object.assign(update.components.asr,{vendor:"qwen",protocol:"qwen_asr_realtime",sampleRate:16000});
    if(scenario==="tencent_asr"){
      Object.assign(update.components.asr,{vendor:"tencent",protocol:"tencent_asr_ws",sampleRate:16000,appId:"10001",modelId:"16k_zh",endpoint:"wss://asr.cloud.tencent.com/asr/v2/10001",authKind:"tencent_secret"});
      Object.assign(update.credentials.asr,{secretId:"SYNTHETIC_ID",secretKey:secret});delete (update.credentials.asr as any).apiKey;
    }
    if(googleAsr){
      Object.assign(update.components.asr,{vendor:"google",protocol:"google_speech_v2",sampleRate:16000,modelId:"long",endpoint:"https://speech.googleapis.com",authKind:scenario==="asr_google_sa"?"google_service_account":"google_adc",
        projectId:"synthetic-project",location:"global",recognizer:"_",languageLocales:{zh:"cmn-Hans-CN",en:"en-US"}});
      delete (update.credentials.asr as any).apiKey;
      if(scenario==="asr_google_sa")Object.assign(update.credentials.asr,{serviceAccountJson:JSON.stringify({type:"service_account",project_id:"synthetic-project",client_email:"synthetic@invalid.test",private_key:generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString()})});
      else{const adc=join(dir,"asr-adc.json");writeFileSync(adc,JSON.stringify({type:"authorized_user",client_id:"SYNTHETIC_ID",client_secret:"SYNTHETIC_SECRET",refresh_token:"SYNTHETIC_REFRESH",quota_project_id:"synthetic-project"}),{mode:0o600});vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE",adc);}
    }
    Object.assign(update.components.tts,{vendor:"openai",protocol:"openai_speech",endpoint:"https://synthetic.invalid/v1",sampleRate:24000,voice:"coral"});
    if(scenario==="qwen")Object.assign(update.components.tts,{vendor:"qwen",protocol:"qwen_tts_realtime",endpoint:"wss://synthetic.invalid/api-ws/v1/realtime",voice:"Cherry"});
    if(scenario==="tencent"){
      Object.assign(update.components.tts,{vendor:"tencent",protocol:"tencent_tts_ws",authKind:"tencent_secret",endpoint:"wss://tts.cloud.tencent.com/stream_wsv2",appId:"10001",voice:"101001",modelId:"",sampleRate:16000});
      Object.assign(update.credentials.tts,{secretId:"SYNTHETIC_ID",secretKey:secret});delete (update.credentials.tts as any).apiKey;
    }
    if(google){
      Object.assign(update.components.tts,{vendor:"google",protocol:"google_cloud_tts",authKind:scenario==="google_sa"?"google_service_account":"google_adc",endpoint:"https://synthetic.invalid/v1",projectId:"synthetic-project",voice:"en-US-Standard-A",modelId:"",sampleRate:24000});
      delete (update.credentials.tts as any).apiKey;
      if(scenario==="google_sa")Object.assign(update.credentials.tts,{serviceAccountJson:JSON.stringify({type:"service_account",project_id:"synthetic-project",client_email:"synthetic@invalid.test",private_key:generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString()})});
      else{const adc=join(dir,"tts-adc.json");writeFileSync(adc,JSON.stringify({type:"authorized_user",client_id:"SYNTHETIC_ID",client_secret:"SYNTHETIC_SECRET",refresh_token:"SYNTHETIC_REFRESH",quota_project_id:"synthetic-project"}),{mode:0o600});vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE",adc);}
    }
    await savePublicModelConfiguration(update);session(true);current().userId="guest-user";const id=current().id;
    const snapshot=await bindPublicModelConfiguration(id,"guest-user",2);
    for(const e of evidence())await recordPublicInferenceEvidence(id,"guest-user",e,now);
    await writePublicInferenceAdmission(id,"guest-user",{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation",tts:"tts"}},now);
    const lease=await issuePublicRuntimeLease(id,"guest-user",now),store=storage.getStoreSnapshot();
    store.billingLedger=[];store.usageHolds=[];store.usageBalances={};store.usagePlanCodes={};
    createUsageHold("guest-user",60,undefined,{sessionId:id,idempotencyKey:`hold:${id}`});
    const app=await buildApp(),errors:unknown[]=[],client:any[]=[];
    let releaseCancelledMetadata!:()=>void;
    const stopped=new Promise<void>(resolve=>releaseCancelledMetadata=resolve);
    const apiFetch:typeof fetch=async(url,init)=>{
      const parsed=new URL(String(url));expect(parsed.origin).toBe("https://synthetic-api.test");
      const payload=JSON.parse(String(init?.body));
      if(scenario==="cancel_tts"&&payload.component==="tts"&&payload.state==="uncertain"){
        await stopped;vi.setSystemTime(new Date(now.getTime()+5000));
      }
      if(scenario==="sync_failure"&&payload.stage==="translation")return new Response("Synthetic storage failure",{status:503});
      const reply=await app.inject({method:"POST",url:parsed.pathname,headers:init?.headers as Record<string,string>,payload});
      if(payload.phase==="stopped")releaseCancelledMetadata();
      return new Response(reply.body,{status:reply.statusCode});
    };
    const transport=createSessionEventSink({sessionEventSink:"api",apiBaseUrl:"https://synthetic-api.test",internalApiSecret:"synthetic-joint-secret",sessionSyncTimeoutMs:1000} as RealtimeEnv,apiFetch);
    const binding={sessionId:id,ownerId:"guest-user",deploymentId:"runtime-test",modelPolicyRevision:snapshot.modelPolicyRevision,
      leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,sampleRate:lease.sampleRate};
    const sink=bindPublicSessionEventSink(transport,binding);
    const providerSession={sessionId:id,userId:"guest-user",sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:true};
    let peer:SyntheticAsrSocket|SyntheticQwenAsrSocket|SyntheticTencentAsrSocket|undefined;
    let asrTranscript="你好，今天测试联合会话。";
    const mtFetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Hello, this is a joint test."}}]})));
    let releaseTts:((response:Response)=>void)|undefined;
    let markTtsStarted!:()=>void;const ttsStarted=new Promise<void>(resolve=>markTtsStarted=resolve);
    const ttsFetch=vi.fn(async(_url:unknown,_init?:RequestInit)=>{
      expect(current().segments.some(s=>s.translatedText==="Hello, this is a joint test.")).toBe(true);
      if(scenario==="cancel_tts")return new Promise<Response>(r=>{releaseTts=r;markTtsStarted();});
      if(scenario==="tts_failure")return new Response("SECRET_PROVIDER_BODY",{status:503});
      if(google)return new Response(JSON.stringify({audioContent:pcm16Wav(Buffer.alloc(1920),24000).toString("base64")}),{headers:{"content-type":"application/json"}});
      return new Response(Buffer.alloc(1920),{headers:{"content-type":"audio/pcm"}});
    });
    const qwenSockets:SyntheticQwenSpeechSocket[]=[];
    const qwenSocketFactory=vi.fn(()=>{expect(current().segments.some(s=>s.translatedText==="Hello, this is a joint test.")).toBe(true);
      const ws=new SyntheticQwenSpeechSocket();qwenSockets.push(ws);return ws.asWebSocket();});
    const tencentSockets:SyntheticTencentSpeechSocket[]=[];
    const tencentSocketFactory=vi.fn((url:string)=>{expect(current().segments.some(s=>s.translatedText==="Hello, this is a joint test.")).toBe(true);
      const ws=new SyntheticTencentSpeechSocket(new URL(url).searchParams.get("SessionId")!);tencentSockets.push(ws);return ws.asWebSocket();});
    const ttsCalls=scenario==="tencent"?tencentSocketFactory:scenario==="qwen"?qwenSocketFactory:ttsFetch;
    const ttsAuthFetch=vi.fn(async()=>new Response(JSON.stringify({access_token:"SYNTHETIC_GOOGLE_TOKEN",expires_in:3600,token_type:"Bearer"})));
    const asrAuthFetch=vi.fn(async()=>new Response(JSON.stringify({access_token:"SYNTHETIC_ASR_TOKEN",expires_in:3600,token_type:"Bearer"})));
    const grpcPeers:SyntheticGoogleAsrStream[]=[];
    const googleStreamFactory:GoogleAsrStreamFactory=()=>{const stream=new SyntheticGoogleAsrStream();stream.transcript=asrTranscript;grpcPeers.push(stream);return stream.transport();};
    const {provider,ttsOutput}=new ProviderRouter().createConfiguredPublicSessionComponents({snapshot,authorization:current().processingAuthorization!,binding,session:providerSession,
      authorizeConnection:async()=>{verifiedPublicAdmission(current(),"guest-user",new Date());},
      resolveAsrCredentials:createPublicModelCredentialResolver(snapshot,"asr",{fetchFn:asrAuthFetch}),resolveTranslationCredentials:createPublicModelCredentialResolver(snapshot,"translation"),googleStreamFactory,
      recordAttempt:e=>sink.modelAttempt(e),fetchFn:mtFetch,socketFactory:url=>{peer=scenario==="tencent_asr"?new SyntheticTencentAsrSocket(new URL(url).searchParams.get("voice_id")!):scenario==="qwen_asr"?new SyntheticQwenAsrSocket():new SyntheticAsrSocket();peer.transcript=asrTranscript;return peer.asWebSocket();},
      output:{resolveCredentials:createPublicModelCredentialResolver(snapshot,"tts",{fetchFn:ttsAuthFetch}),fetchFn:ttsFetch,socketFactory:scenario==="tencent"?tencentSocketFactory:qwenSocketFactory,prefillMs:20,isSessionActive:()=>getSession(id)?.status==="active"}});
    const tracker=new RealtimeFlushTracker();
    const dispatcher=new RealtimeEventDispatcher({eventSink:sink,sendClient:e=>client.push(e),onSyncError:(_e,error)=>errors.push(error),
      afterSend:e=>{tracker.record(e);ttsOutput!.enqueue(e,dispatcher.send);}});
    const drain=()=>dispatcher.drain(),confirm=()=>sink.confirmAudio();
    const batcher=new AudioFrameBatcher({sessionId:id,provider,send:dispatcher.send,onError:e=>errors.push(e),acceptFrame:f=>sink.acceptAudio(f),beforeSend:confirm,batchDelayMs:10000});
    createSession({sessionId:id,userId:"guest-user",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:true,planCode:"free",maxDurationSeconds:60,issuedAt:0,expiresAt:9999999999});
    const finalizer=new RealtimeSessionFinalizer({sessionId:id,provider,audioBatcher:batcher,send:dispatcher.send,drainSessionSync:drain,
      flushTracker:tracker,onError:(_s,e)=>errors.push(e),confirmed:{beforeFlush:confirm},ttsOutput});
    let audioSequence=0;
    const boundary=async(n:number)=>{
      if(googleAsr&&n===1){batcher.enqueue({type:"audio.frame",sessionId:id,sequence:++audioSequence,timestampMs:Date.now(),format:"pcm16",sampleRate:asrRate,data:Buffer.alloc(asrRate*0.2).toString("base64")});
        await batcher.flush();expect(current().publicModelAttempts![0].event).toMatchObject({state:"dispatching",audioEndSample:asrRate/10});}
      batcher.enqueue({type:"audio.frame",sessionId:id,sequence:++audioSequence,timestampMs:Date.now(),format:"pcm16",sampleRate:asrRate,data:Buffer.alloc(asrRate*(googleAsr&&n===1?0.2:0.4)).toString("base64")});
      await handleAudioBoundary({type:"audio.boundary",sessionId:id,sequence:audioSequence},{sessionId:id,confirmed:true,batcher,provider,beforeFlush:confirm,drain,send:dispatcher.send});};
    try {
      dispatcher.send({type:"session.started",sessionId:id});await drain();await provider.createSession(providerSession);
      vi.setSystemTime(new Date(now.getTime()+1000));await boundary(1);
      if(scenario==="sync_failure"){
        await expect(drain()).rejects.toThrow();expect(ttsFetch).not.toHaveBeenCalled();
        await expect(finalizer.finalize("client_request")).rejects.toThrow();expect(client.some(e=>e.type==="session.ended")).toBe(false);return;
      }
      if(scenario==="cancel_tts")await ttsStarted;
      else {await ttsOutput!.drain();await drain();}
      if(normal) {
        expect(client.filter(e=>e.type==="audio.output")).toHaveLength(scenario==="tencent"?3:2);
        vi.setSystemTime(new Date(now.getTime()+2000));
        await handleControlEvent({type:"session.pause",sessionId:id},id,provider,batcher,dispatcher.send,async()=>{},ttsOutput,{beforeFlush:confirm,drain});
        expect(current().status).toBe("paused");
        vi.setSystemTime(new Date(now.getTime()+10000));await confirm();
        await handleControlEvent({type:"session.resume",sessionId:id},id,provider,batcher,dispatcher.send,async()=>{},ttsOutput,{beforeFlush:confirm,drain});
        await boundary(2);await ttsOutput!.drain();await drain();expect(ttsCalls).toHaveBeenCalledTimes(2);
        // Leave accepted tail input for finalizer; it must save it but not start TTS.
        asrTranscript="结束之前的最后一句应当保存。";if(peer)peer.transcript=asrTranscript;
        batcher.enqueue({type:"audio.frame",sessionId:id,sequence:++audioSequence,timestampMs:Date.now(),format:"pcm16",sampleRate:asrRate,data:Buffer.alloc(asrRate*0.4).toString("base64")});
        vi.setSystemTime(new Date(now.getTime()+11000));
      }
      await Promise.all([finalizer.finalize("client_request"),finalizer.finalize("client_request")]);
      if(scenario==="cancel_tts"){expect(ttsFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);releaseTts!(new Response(Buffer.alloc(1920)));}
      expect(current().status).toBe("ended");expect(current().segments.length).toBe(normal?3:1);
      if(normal)expect(current().segments.some(s=>s.sourceText==="结束之前的最后一句应当保存。")).toBe(true);
      expect(storage.getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${id}`)).toHaveLength(1);
      expect(current().consumedSeconds).toBe(normal?3:1);
      expect(ttsCalls).toHaveBeenCalledTimes(normal?2:1);
      expect(current().publicModelAttempts!.filter(a=>a.event.component==="tts").map(a=>a.event.state)).toEqual(normal?["confirmed","confirmed"]:["uncertain"]);
      if(scenario==="qwen"){
        expect(ttsFetch).not.toHaveBeenCalled();expect(qwenSockets.every(s=>s.readyState===3)).toBe(true);
        for(const a of current().publicModelAttempts!.filter(a=>a.event.component==="tts"))expect(a.event).toMatchObject({providerId:"qwen",metadata:{usage:{billedCharacters:12}}});
      }
      if(scenario==="tencent"){
        expect(ttsFetch).not.toHaveBeenCalled();expect(tencentSockets.every(s=>s.readyState===3)).toBe(true);
        expect(snapshot.components.tts!.modelId).toBe("service:tencent_tts_ws");expect(readPublicModelConfiguration().components.tts.modelId).toBe("");
        expect(client.filter(e=>e.type==="audio.output").every(e=>e.sampleRate===16000)).toBe(true);
        for(const a of current().publicModelAttempts!.filter(a=>a.event.component==="tts")){
          expect(a.event).toMatchObject({providerId:"tencent",modelId:"service:tencent_tts_ws",metadata:{requestId:"tencent-request"}});
          expect(a.event.metadata?.usage).toBeUndefined();expect(a.event.metadata?.reportedModel).toBeUndefined();
        }
      }
      if(google){
        expect(ttsAuthFetch).toHaveBeenCalledTimes(1);expect(ttsFetch.mock.calls[0][1]?.headers).toMatchObject({authorization:"Bearer SYNTHETIC_GOOGLE_TOKEN","x-goog-user-project":"synthetic-project"});
        expect(snapshot.components.tts!.modelId).toBe("service:google_cloud_tts");expect(readPublicModelConfiguration().components.tts.modelId).toBe("");
        for(const a of current().publicModelAttempts!.filter(a=>a.event.component==="tts")){expect(a.event).toMatchObject({providerId:"google",modelId:"service:google_cloud_tts"});expect(a.event.metadata?.usage).toBeUndefined();}
      }else expect(ttsAuthFetch).not.toHaveBeenCalled();
      if(scenario==="qwen_asr")for(const a of current().publicModelAttempts!.filter(a=>a.event.component==="asr"))expect(a.event).toMatchObject({providerId:"qwen",audioSampleRate:16000,state:"confirmed"});
      if(scenario==="tencent_asr")for(const a of current().publicModelAttempts!.filter(a=>a.event.component==="asr"))expect(a.event).toMatchObject({providerId:"tencent",audioSampleRate:16000,state:"confirmed"});
      if(!normal)expect(client.filter(e=>e.type==="audio.output")).toHaveLength(0);
      if(scenario==="tts_failure")expect(client).toContainEqual(expect.objectContaining({type:"error",stage:"tts",retryable:false}));
      if(googleAsr){expect(asrAuthFetch).toHaveBeenCalledTimes(1);expect(grpcPeers).toHaveLength(3);expect(grpcPeers.every(p=>p.clientClosed)).toBe(true);
        for(const a of current().publicModelAttempts!.filter(a=>a.event.component==="asr"))expect(a.event).toMatchObject({providerId:"google",audioSampleRate:16000,state:"confirmed",metadata:{usage:{audioSeconds:1}}});
      }else{expect(asrAuthFetch).not.toHaveBeenCalled();expect(peer!.readyState).toBe(3);}
      expect(errors).toEqual([]);
    } finally {releaseCancelledMetadata();batcher.stopAccepting();ttsOutput!.close();await provider.closeSession(id);await ttsOutput!.drainInFlight();deleteSession(id);await app.close();vi.useRealTimers();}
  });
});
