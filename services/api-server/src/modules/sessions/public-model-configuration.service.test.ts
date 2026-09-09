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
describe("manual configuration binding on the original session aggregate",()=>{
  it("sends configured TTS through the original queue and API journal, rejecting duplicate synthesis identities",async()=>{
    const update=body(1);Object.assign(update.components.tts,{vendor:"openai",protocol:"openai_speech",endpoint:"https://synthetic.invalid/v1",sampleRate:24000,voice:"coral"});
    await savePublicModelConfiguration(update);session(true);const snapshot=await bind(2);
    for(const e of evidence())await recordPublicInferenceEvidence(current().id,"owner",e,now);
    await writePublicInferenceAdmission(current().id,"owner",{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation",tts:"tts"}},now);
    const lease=await issuePublicRuntimeLease(current().id,"owner",now);
    await observePublicRuntime(current().id,{leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,phase:"active",finalRevision:0,sequence:1,lastAcceptedSample:0},now);
    const fetchFn=vi.fn(async()=>new Response(Buffer.alloc(1920),{headers:{"content-type":"audio/pcm","x-request-id":"synthetic-tts"}}));
    const queue=createConfiguredPublicTtsOutputQueue({snapshot,authorization:current().processingAuthorization!,deploymentId:"runtime-test",sessionId:current().id,leaseId:lease.leaseId,prefillMs:20,
      resolveCredentials:createPublicModelCredentialResolver(snapshot,"tts"),record:async e=>{await recordPublicModelAttempt(current().id,e,now);},fetchFn},()=>true);
    const output:unknown[]=[],e={type:"translation.final" as const,sessionId:current().id,segmentId:"tts-segment",revision:1,text:"Hello world",language:"en" as const};
    try{
      queue.enqueue(e,a=>output.push(a));queue.enqueue(e,a=>output.push(a));await queue.drain();expect(fetchFn).toHaveBeenCalledTimes(1);expect(output).toHaveLength(2);
      const recorded=current().publicModelAttempts!;expect(recorded).toHaveLength(1);const attempt=recorded[0].event;
      expect(attempt).toMatchObject({component:"tts",state:"confirmed",providerId:"openai",modelId:"manual-tts",metadata:{requestId:"synthetic-tts"}});
      expect(attempt.metadata?.usage).toBeUndefined();expect(JSON.stringify(recorded)).not.toContain("Hello world");
      await expect(recordPublicModelAttempt(current().id,{...attempt,attemptId:"duplicate",state:"dispatching",metadata:undefined},now)).rejects.toThrow("tts_duplicate");
      expect(()=>recordPublicModelAttempt(current().id,{...attempt,audioStartSample:0,audioEndSample:100,audioSampleRate:24000},now)).toThrow("invalid_model_attempt");
      await expect(recordPublicModelAttempt(current().id,{...attempt,attemptId:"wrong-model",segmentId:"new",state:"dispatching",metadata:undefined,modelId:"wrong"},now)).rejects.toThrow("model_mismatch");
      expect(current().consumedSeconds).toBe(0);
    }finally{queue.close();}
  });
  it("binds one redacted snapshot atomically and retries without changing session version",async()=>{
    const before=structuredClone(storage.getStoreSnapshot());
    const bound=await Promise.all([bind(),bind(),bind()]);expect(bound[0]).toEqual(bound[1]);
    expect(current().version).toBe((before.sessions[0].version??1)+1);expect(current().publicModelConfiguration).toEqual(bound[0]);
    expect(JSON.stringify(current())).not.toContain(secret);expect(JSON.stringify(readPublicModelConfiguration())).not.toContain(secret);
    expect(readFileSync(join(dir,"public.enc"),"utf8")).not.toContain(secret);
    expect(storage.getStoreSnapshot().billingLedger).toEqual(before.billingLedger);
    expect(storage.getStoreSnapshot().usageHolds).toEqual(before.usageHolds);
    expect(current().publicInferenceAdmission).toBeUndefined();expect(current().publicRuntimePolicy).toBeUndefined();
  });
  it("resolves only the exact current component credentials without putting them in the snapshot",()=>{
    const s=capturePublicModelRuntimeConfiguration(false);
    expect(resolvePublicModelRuntimeCredentials(s,"translation")).toEqual({apiKey:secret});
    expect(()=>resolvePublicModelRuntimeCredentials(s,"tts")).toThrow("component_disabled");
    s.components.translation!.endpoint="https://other.invalid";
    expect(()=>resolvePublicModelRuntimeCredentials(s,"translation")).toThrow("config_changed");
  });
  it("leaves the old snapshot unchanged and refuses credentials after key rotation",async()=>{
    const s=await bind(),old=structuredClone(s);const update=body(1);update.credentials.translation.apiKey="SYNTHETIC_ROTATED";
    await savePublicModelConfiguration(update);expect(s).toEqual(old);expect(current().publicModelConfiguration).toEqual(old);
    expect(()=>resolvePublicModelRuntimeCredentials(s,"translation")).toThrow("config_changed");
    await expect(bind()).rejects.toThrow("revision_conflict");
    const next=capturePublicModelRuntimeConfiguration(false);expect(next.configurationRevision).toBe(2);expect(next.modelPolicyRevision).not.toBe(s.modelPolicyRevision);
    expect(resolvePublicModelRuntimeCredentials(next,"translation").apiKey).toBe("SYNTHETIC_ROTATED");
  });
  it.each(["asr","translation"] as const)("rejects missing %s credentials before session mutation",async component=>{
    await savePublicModelConfiguration({...body(1),credentials:{},clearCredentials:[component]});const before=structuredClone(current());
    await expect(bind(2)).rejects.toThrow(`${component}_not_configured`);expect(current()).toEqual(before);
  });
  it("does not require disabled session TTS, but requires it when voice output is enabled",async()=>{
    const update=body(1);update.components.tts.enabled=false;await savePublicModelConfiguration(update);
    session(false);await bind(2);expect(current().publicModelConfiguration!.components.tts).toBeUndefined();
    expect(()=>capturePublicModelRuntimeConfiguration(true)).toThrow("tts_not_configured");
  });
  it("captures TTS when enabled without changing language or granting text sync",async()=>{
    session(true);const language=structuredClone(current().processingAuthorization!.languagePolicy);
    await bind();expect(current().publicModelConfiguration!.components.tts?.modelId).toBe("manual-tts");
    expect(current().processingAuthorization!.languagePolicy).toEqual(language);
    expect(current().processingAuthorization!.syncPermission).toEqual({allowed:false});
  });
  it.each(["modelPolicyRevision","executionPlan"])("does not rewrite the authorized %s",async field=>{
    if(field==="modelPolicyRevision")current().processingAuthorization!.modelPolicyRevision="old-policy";
    else current().processingAuthorization!.executionPlan.asr={execution:"public",scopeKey:"old-scope",reason:"online_selected"};
    const before=structuredClone(current());await expect(bind()).rejects.toThrow("processing_mismatch");expect(current()).toEqual(before);
  });
  it.each(["owner","deployment","local"])("rejects %s mismatch",async field=>{
    if(field==="owner")current().userId="other";
    if(field==="deployment")current().processingDeploymentId="other";
    if(field==="local")(current().processingAuthorization as any).processingMode="local";
    const before=structuredClone(current());await expect(bind()).rejects.toThrow();expect(current()).toEqual(before);
  });
  it("rejects stale expected revisions",async()=>{await expect(bind(2)).rejects.toThrow("revision_conflict");expect(current().publicModelConfiguration).toBeUndefined();});
  it.each(["status","publicInferenceEvidence","publicGrantRef"])("seals initial binding after %s",async field=>{
    if(field==="status")current().status="active";
    if(field==="publicInferenceEvidence")current().publicInferenceEvidence=[{} as PublicInferenceEvidence];
    if(field==="publicGrantRef")current().processingAuthorization!.publicGrantRef="issued";
    const before=structuredClone(current());await expect(bind()).rejects.toThrow("binding_sealed");expect(current()).toEqual(before);
  });
  it("binds configuration through stored evidence, admission and original lease with synthetic receipts",async()=>{
    await bind();for(const e of evidence())await recordPublicInferenceEvidence(current().id,"owner",e,now);
    await writePublicInferenceAdmission(current().id,"owner",{consentReceiptId:"consent",budgetReservationId:"budget",
      qualificationReceiptIds:{asr:"asr",translation:"translation"}},now);
    const lease=await issuePublicRuntimeLease(current().id,"owner",now);expect(lease.maxActiveSeconds).toBe(60);
    expect(JSON.stringify(current())).not.toContain(secret);
  });
  it.each(["providerId","modelId","providerPolicyRevision","sampleRate"])("rejects qualification/budget %s inconsistent with the configuration",async field=>{
    await bind();const e=field==="sampleRate"?{...evidence()[1],sampleRate:24000}:{...evidence()[2],[field]:"other"};
    await expect(recordPublicInferenceEvidence(current().id,"owner",e as PublicInferenceEvidence,now)).rejects.toThrow("config_mismatch");
    expect(current().publicInferenceEvidence).toBeUndefined();
  });
  it("does not treat ADC configuration as an available credential",async()=>{
    const update=body(1);Object.assign(update.components.translation,{vendor:"google",protocol:"google_vertex_gemini",authKind:"google_adc",projectId:"synthetic",location:"global"});
    await savePublicModelConfiguration({...update,credentials:{}});
    const s=capturePublicModelRuntimeConfiguration(false);expect(()=>resolvePublicModelRuntimeCredentials(s,"translation")).toThrow("adc_not_resolved");
  });
  it("fails closed on lost encryption key without consulting private storage",()=>{
    vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","");expect(()=>capturePublicModelRuntimeConfiguration(false)).toThrow("storage_not_ready");
  });
  it("consumes encrypted manual configuration through the original Router/client and real attempt writer",async()=>{
    const snapshot=await bind();for(const e of evidence())await recordPublicInferenceEvidence(current().id,"owner",e,now);
    await writePublicInferenceAdmission(current().id,"owner",{consentReceiptId:"consent",budgetReservationId:"budget",
      qualificationReceiptIds:{asr:"asr",translation:"translation"}},now);
    const lease=await issuePublicRuntimeLease(current().id,"owner",now);
    await observePublicRuntime(current().id,{leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,
      sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0},now);
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({model:"manual-translation",choices:[{finish_reason:"stop",message:{content:"Hello"}}]})));
    const client=new ProviderRouter().createConfiguredTranslationClient({snapshot,authorization:current().processingAuthorization!,deploymentId:"runtime-test",
      resolveCredentials:()=>resolvePublicModelRuntimeCredentials(snapshot,"translation"),fetchFn,
      attemptRecorder:{sessionId:current().id,leaseId:lease.leaseId,providerId:"qwen",record:async e=>{await recordPublicModelAttempt(current().id,e,now);}}});
    expect(await client.translate({text:"你好",sourceLanguage:"zh",targetLanguage:"en",attemptContext:{segmentId:"seg",revision:1}})).toBe("Hello");
    expect(current().publicModelAttempts).toHaveLength(1);expect(current().publicModelAttempts![0].event).toMatchObject({state:"confirmed",modelId:"manual-translation",providerId:"qwen"});
    expect(JSON.stringify(current())).not.toContain(secret);
    await savePublicModelConfiguration(body(1));
    await expect(client.translate({text:"再次",sourceLanguage:"zh",targetLanguage:"en",attemptContext:{segmentId:"next",revision:1}})).rejects.toMatchObject({outcome:"not_sent"});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(current().publicModelAttempts).toHaveLength(1);
  });
  it.each(publicModelCatalog.protocols.map(p=>[p.id,p] as const))("selects manual %s parameters without requiring one fixed supplier",async(_id,p)=>{
    const update=body(1),component=p.component;
    Object.assign(update.components[component],{vendor:p.vendor,protocol:p.id,authKind:p.auth[0],
      endpoint:`${p.scheme}//configured.invalid/path`,modelId:p.modelRequired?"chosen-model":"",appId:"10001",
      projectId:"synthetic-project",location:"global",recognizer:"_",voice:"chosen-voice",timeoutMs:2300,maxTokens:900,sampleRate:24000});
    const values={apiKey:secret,secretId:"SYNTHETIC_ID",secretKey:secret,serviceAccountJson:JSON.stringify({
      type:"service_account",project_id:"synthetic-project",client_email:"synthetic@invalid.test",private_key:"-----BEGIN PRIVATE KEY-----SYNTHETIC_ONLY"})};
    const credentials=Object.fromEntries(publicModelCatalog.credentialFields[p.auth[0]].map(key=>[key,values[key as keyof typeof values]]));
    if(p.id==="google_speech_v2")update.components[component].languageLocales={zh:"cmn-Hans-CN",en:"en-US"};
    await savePublicModelConfiguration({...update,credentials:{[component]:credentials}});
    const s=capturePublicModelRuntimeConfiguration(true);
    expect(s.components[component]).toEqual(["tencent_tts_ws","google_cloud_tts"].includes(p.id)?{...update.components[component],modelId:`service:${p.id}`}:update.components[component]);
    expect(s.executionPlan[component]).toMatchObject({execution:"public",reason:"online_selected"});
    expect(resolvePublicModelRuntimeCredentials(s,component)).toEqual(credentials);
    expect(JSON.stringify(s)).not.toContain(secret);
  });
  it.each(["gemini","google_service_account","google_adc"])("journals native Google usage through configured credential resolver with %s",async auth=>{
    const vertex=auth!=="gemini";
    const update=body(1);Object.assign(update.components.translation,{vendor:"google",protocol:vertex?"google_vertex_gemini":"google_gemini",
      authKind:vertex?auth:"api_key",endpoint:"https://synthetic.invalid",modelId:"selected-gemini",projectId:"synthetic-project",location:"global"});
    const serviceAccountJson=auth==="google_service_account"?JSON.stringify({type:"service_account",project_id:"synthetic-project",client_email:"synthetic@invalid.test",
      private_key:generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString()}):undefined;
    if(auth==="google_adc"){
      const adc=join(dir,"adc.json");writeFileSync(adc,JSON.stringify({type:"authorized_user",client_id:"SYNTHETIC_ID",client_secret:"SYNTHETIC_SECRET",refresh_token:"SYNTHETIC_REFRESH",quota_project_id:"synthetic-quota"}),{mode:0o600});vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE",adc);
    }
    await savePublicModelConfiguration({...update,credentials:serviceAccountJson?{translation:{serviceAccountJson}}:vertex?{}:{translation:{apiKey:secret}}});session();
    const snapshot=await bind(2);for(const e of evidence())await recordPublicInferenceEvidence(current().id,"owner",e,now);
    await writePublicInferenceAdmission(current().id,"owner",{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}},now);
    const lease=await issuePublicRuntimeLease(current().id,"owner",now);
    await observePublicRuntime(current().id,{leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0},now);
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({responseId:"synthetic-google-reply",modelVersion:"selected-gemini-v2",
      candidates:[{finishReason:"STOP",content:{role:"model",parts:[{text:"Hello"}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,thoughtsTokenCount:3,cachedContentTokenCount:4,totalTokenCount:15}})));
    const authFetch=vi.fn(async()=>new Response(JSON.stringify({access_token:"SYNTHETIC_TOKEN",expires_in:3600,token_type:"Bearer"})));
    const client=new ProviderRouter().createConfiguredTranslationClient({snapshot,authorization:current().processingAuthorization!,deploymentId:"runtime-test",fetchFn,
      resolveCredentials:createPublicModelCredentialResolver(snapshot,"translation",{fetchFn:authFetch}),
      attemptRecorder:{sessionId:current().id,leaseId:lease.leaseId,providerId:"google",record:async e=>{await recordPublicModelAttempt(current().id,e,now);}}});
    expect(await client.translate({text:"你好",sourceLanguage:"zh",targetLanguage:"en",attemptContext:{segmentId:"google-seg",revision:1}})).toBe("Hello");
    expect(authFetch).toHaveBeenCalledTimes(vertex?1:0);
    expect((fetchFn.mock.calls[0] as any)[1].headers["x-goog-user-project"]).toBe(auth==="google_adc"?"synthetic-quota":undefined);
    const event=current().publicModelAttempts![0].event;
    expect(event).toMatchObject({providerId:"google",modelId:"selected-gemini",state:"confirmed",metadata:{usage:{promptTokens:10,completionTokens:2,thoughtTokens:3,cachedPromptTokens:4,totalTokens:15}}});
    expect((await recordPublicModelAttempt(current().id,event,now)).costStatus).toBe("unknown");
    const changed=structuredClone(event);changed.metadata!.usage!.thoughtTokens=99;
    await expect(recordPublicModelAttempt(current().id,changed,now)).rejects.toThrow("conflict");
    expect(JSON.stringify(current())).not.toContain(secret);expect(JSON.stringify(current())).not.toContain("SYNTHETIC_TOKEN");
  });
  it.each(["openai","qwen"])("runs completed PCM through configured %s ASR and the original attempt writer with confirmed audio bounds",async vendor=>{
    const update=body(1);Object.assign(update.components.asr,{vendor,protocol:vendor==="qwen"?"qwen_asr_compatible":"openai_transcriptions",endpoint:"https://synthetic.invalid/v1"});
    await savePublicModelConfiguration(update);session();const snapshot=await bind(2);
    for(const e of evidence())await recordPublicInferenceEvidence(current().id,"owner",e,now);
    await writePublicInferenceAdmission(current().id,"owner",{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}},now);
    const lease=await issuePublicRuntimeLease(current().id,"owner",now);
    const runtime={leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,phase:"active",finalRevision:0};
    await observePublicRuntime(current().id,{...runtime,sequence:1,lastAcceptedSample:0},now);
    const tick=new Date(now.getTime()+1000);await observePublicRuntime(current().id,{...runtime,sequence:2,lastAcceptedSample:16000},tick);
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify(vendor==="qwen"?{choices:[{finish_reason:"stop",message:{role:"assistant",content:"你好"}}],
      usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,prompt_tokens_details:{audio_tokens:9,text_tokens:1}}}:
      {text:"你好",usage:{type:"tokens",input_tokens:10,output_tokens:2,total_tokens:12,input_token_details:{audio_tokens:9,text_tokens:1}}})));
    const client=new ProviderRouter().createConfiguredAsrClient({snapshot,authorization:current().processingAuthorization!,deploymentId:"runtime-test",sessionId:current().id,leaseId:lease.leaseId,
      resolveCredentials:createPublicModelCredentialResolver(snapshot,"asr"),fetchFn,record:async e=>{await recordPublicModelAttempt(current().id,e,tick);}});
    const audio={sessionId:current().id,segmentId:"asr-turn",revision:1,complete:true as const,pcm:new Uint8Array(32000),sampleRate:16000 as const,startSample:0,sourceLanguage:"zh" as const};
    const transcript=await client.transcribeCompletedAudio(audio);expect(transcript?.text).toBe("你好");const event=current().publicModelAttempts![0].event;
    expect(event).toMatchObject({component:"asr",providerId:vendor,audioStartSample:0,audioEndSample:16000,state:"confirmed",metadata:{usage:{audioInputTokens:9,textInputTokens:1}}});
    // New UUID must not permit resending an already charged/uncertain range.
    await expect(client.transcribeCompletedAudio(audio)).rejects.toMatchObject({outcome:"not_sent"});expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(recordPublicModelAttempt(current().id,{...event,attemptId:"past-watermark",state:"dispatching",metadata:undefined,audioStartSample:16000,audioEndSample:32000},tick)).rejects.toThrow("audio_unconfirmed");
    await expect(recordPublicModelAttempt(current().id,{...event,attemptId:"rate-mismatch",state:"dispatching",metadata:undefined,audioSampleRate:24000},tick)).rejects.toThrow("audio_unconfirmed");
    await expect(recordPublicModelAttempt(current().id,{...event,audioEndSample:16001},tick)).rejects.toThrow("conflict");
    expect((await recordPublicModelAttempt(current().id,event,tick)).costStatus).toBe("unknown");
    const mtFetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Hello"}}]})));
    const mt=new ProviderRouter().createConfiguredTranslationClient({snapshot,authorization:current().processingAuthorization!,deploymentId:"runtime-test",fetchFn:mtFetch,
      resolveCredentials:createPublicModelCredentialResolver(snapshot,"translation"),
      attemptRecorder:{sessionId:current().id,leaseId:lease.leaseId,providerId:"qwen",record:async e=>{await recordPublicModelAttempt(current().id,e,tick);}}});
    expect(await mt.translate({text:transcript!.text,sourceLanguage:transcript!.language,targetLanguage:"en",attemptContext:{segmentId:transcript!.segmentId,revision:1}})).toBe("Hello");
    expect(current().publicModelAttempts!.map(a=>a.event.component)).toEqual(["asr","translation"]);expect(mtFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(current().publicModelAttempts)).not.toContain("你好");expect(JSON.stringify(current().publicModelAttempts)).not.toContain(secret);
  });
  it.each(["openai","qwen","tencent"])("extends one %s streaming intent per confirmed prefix into original MT",async vendor=>{
    const sampleRate=vendor!=="openai"?16000:24000,step=sampleRate/10;
    const update=body(1);Object.assign(update.components.asr,{vendor,protocol:vendor==="tencent"?"tencent_asr_ws":vendor==="qwen"?"qwen_asr_realtime":"openai_realtime_asr",endpoint:"wss://synthetic.invalid/v1/realtime",sampleRate});
    if(vendor==="tencent"){Object.assign(update.components.asr,{endpoint:"wss://asr.cloud.tencent.com/asr/v2/10001",appId:"10001",modelId:"16k_zh",authKind:"tencent_secret"});Object.assign(update.credentials.asr,{secretId:"SYNTHETIC_ID",secretKey:secret});delete (update.credentials.asr as any).apiKey;}
    await savePublicModelConfiguration(update);session();const snapshot=await bind(2);
    for(const e of evidence())await recordPublicInferenceEvidence(current().id,"owner",e,now);
    await writePublicInferenceAdmission(current().id,"owner",{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}},now);
    const lease=await issuePublicRuntimeLease(current().id,"owner",now),runtime={leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,phase:"active",finalRevision:0};
    let tick=now;await observePublicRuntime(current().id,{...runtime,sequence:1,lastAcceptedSample:0},tick);
    const router=new ProviderRouter();let peer:SyntheticAsrSocket|SyntheticQwenAsrSocket|SyntheticTencentAsrSocket;
    const mtFetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Hello, today we test streaming recognition."}}]})));
    const providerSession={sessionId:current().id,userId:"owner",sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false};
    const provider=router.createConfiguredPublicSessionProvider({snapshot,authorization:current().processingAuthorization!,session:providerSession,
      binding:{sessionId:current().id,ownerId:"owner",deploymentId:"runtime-test",modelPolicyRevision:snapshot.modelPolicyRevision,
        leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,sampleRate:lease.sampleRate},
      authorizeConnection:async()=>{verifiedPublicAdmission(current(),"owner",tick);},
      resolveAsrCredentials:createPublicModelCredentialResolver(snapshot,"asr"),resolveTranslationCredentials:createPublicModelCredentialResolver(snapshot,"translation"),
      recordAttempt:async e=>{await recordPublicModelAttempt(current().id,e,tick);},fetchFn:mtFetch,
      socketFactory:url=>{peer=vendor==="tencent"?new SyntheticTencentAsrSocket(new URL(url).searchParams.get("voice_id")!):vendor==="qwen"?new SyntheticQwenAsrSocket():new SyntheticAsrSocket();peer.transcript="你好，今天测试流式识别。";return peer.asWebSocket();}});
    expect(provider).toBeInstanceOf(LmStudioRealtimeProvider);
    await provider.createSession(providerSession);
    for(let n=1;n<=2;n++){
      tick=new Date(now.getTime()+n*100);await observePublicRuntime(current().id,{...runtime,sequence:n+1,lastAcceptedSample:n*step},tick);
      const frame={type:"audio.frame" as const,sessionId:current().id,sequence:n,timestampMs:tick.getTime(),format:"pcm16" as const,sampleRate,data:Buffer.alloc(step*2).toString("base64")};
      markAcceptedAudioRange(frame,{startSample:(n-1)*step,endSample:n*step});for await(const _event of provider.sendAudio(frame)){}
    }
    const intent=structuredClone(current().publicModelAttempts![0].event);expect(intent).toMatchObject({state:"dispatching",audioStartSample:0,audioEndSample:step*2});expect(current().publicModelAttempts).toHaveLength(1);
    await expect(recordPublicModelAttempt(current().id,{...intent,audioEndSample:step},tick)).rejects.toThrow("conflict");
    await expect(recordPublicModelAttempt(current().id,{...intent,audioStartSample:1},tick)).rejects.toThrow("conflict");
    await expect(recordPublicModelAttempt(current().id,{...intent,audioEndSample:step*3},tick)).rejects.toThrow("audio_unconfirmed");
    const output=[];for await(const event of provider.flushSession(current().id))output.push(event);
    expect(output.some(e=>e.type==="transcript.final")).toBe(true);expect(mtFetch).toHaveBeenCalledTimes(1);
    expect(current().publicModelAttempts!.map(a=>[a.event.component,a.event.state])).toEqual([["asr","confirmed"],["translation","confirmed"]]);
    tick=new Date(now.getTime()+300);await observePublicRuntime(current().id,{...runtime,sequence:4,lastAcceptedSample:step*3},tick);
    await expect(recordPublicModelAttempt(current().id,{...intent,audioEndSample:step*3},tick)).rejects.toThrow("conflict");
    await provider.closeSession(current().id);expect(peer!.readyState).toBe(3);
  });
});
