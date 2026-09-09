import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {CreateRealtimeSessionRequest,AudioFrame,PublicModelAttemptEvent} from "@translation/contracts";
import {publicRuntimeTokenBinding} from "@translation/contracts";
import {installConfigurationFixture,body,evidence,current,now} from "../sessions/public-model-configuration.test-support.js";
import * as storage from "../../infrastructure/storage/json-store.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission,revokePublicInferenceEvidence} from "../sessions/public-inference-admission.service.js";
import {issuePublicRuntimeLease,verifiedPublicAdmission} from "../sessions/public-runtime-admission.js";
import {observePublicRuntime} from "../sessions/public-session-runtime.service.js";
import {recordPublicModelAttempt} from "../sessions/public-model-attempt.service.js";
import {markAcceptedAudioRange} from "../../../../realtime-gateway/src/connection/accepted-audio-range.js";
import * as holds from "../usage/usage-hold-runtime.service.js";
import {preparePublicRealtimeSession} from "./public-realtime-preparation.js";
import {issuePublicRealtimeSession} from "./public-realtime-issuer.js";
import {verifyRealtimeToken} from "../../../../realtime-gateway/src/auth/realtime-token-verifier.js";
import {ProviderRouter} from "../../../../realtime-gateway/src/providers/provider-router.js";
import {SyntheticAsrSocket} from "../../../../realtime-gateway/src/asr/streaming-asr.test-support.js";
import {SyntheticQwenAsrSocket} from "../../../../realtime-gateway/src/asr/qwen-streaming-asr.test-support.js";
import {createPublicModelCredentialResolver} from "../models/public-model-credential-resolver.js";
import {buildApp} from "../../app.js";

const id="configured-session",owner="owner",signing="SYNTHETIC_ISSUER_SIGNING_SECRET_NOT_REAL";
installConfigurationFixture();
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  vi.stubEnv("REALTIME_TOKEN_SECRET",signing);vi.stubEnv("REALTIME_WS_ENDPOINT","wss://gateway.synthetic.invalid/realtime");
  const s=storage.getStoreSnapshot();s.sessions=[];s.usageHolds=[];s.billingLedger=[];s.usageBalances={};s.usagePlanCodes={};
});
afterEach(()=>vi.useRealTimers());
async function request(vendor="qwen",voiceOutput=false){
  const update=body(1);if(vendor==="openai")Object.assign(update.components.asr,{vendor,protocol:"openai_realtime_asr",sampleRate:24000});
  await savePublicModelConfiguration(update);
  const config=capturePublicModelRuntimeConfiguration(voiceOutput);
  return {mode:"meeting",sourceLanguage:"zh",targetLanguage:"en",voiceOutput,speakerAttribution:{mode:"off"},
    processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:config.modelPolicyRevision,executionPlan:config.executionPlan,
      languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncRequested:true}} satisfies CreateRealtimeSessionRequest;
}
async function grant(){
  for(const e of evidence())await recordPublicInferenceEvidence(id,owner,e,new Date());
  await writePublicInferenceAdmission(id,owner,{consentReceiptId:"consent",budgetReservationId:"budget",
    qualificationReceiptIds:{asr:"asr",translation:"translation",...(current().publicModelConfiguration!.components.tts?{tts:"tts"}:{})}},new Date());
}
async function prepared(vendor="qwen",voice=false){const input=await request(vendor,voice);await preparePublicRealtimeSession(id,owner,input,new Date());return input;}
describe("original public session preparation and issuance phases",()=>{
  it("prepares one original aggregate without a token, grant, inference or quota hold",async()=>{
    const input=await request();const [a,b]=await Promise.all([preparePublicRealtimeSession(id,owner,input,new Date()),preparePublicRealtimeSession(id,owner,input,new Date())]);
    expect(a).toEqual(b);expect(a.status).toBe("prepared_not_admitted");expect(a).not.toHaveProperty("realtimeToken");
    expect(storage.getStoreSnapshot().sessions).toHaveLength(1);expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
    expect(current()).not.toHaveProperty("publicInferenceAdmission");expect(current().processingAuthorization!.syncPermission).toEqual({allowed:false});
    await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow("admission_required");expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it("rolls back a failed prepared-session write instead of reporting an in-memory-only retry as durable",async()=>{
    const input=await request(),persist=storage.persistStoreSnapshot;let fail=true;
    vi.spyOn(storage,"persistStoreSnapshot").mockImplementation(()=>{if(fail){fail=false;throw Error("synthetic prepare failure");}return persist();});
    await expect(preparePublicRealtimeSession(id,owner,input,new Date())).rejects.toThrow("synthetic prepare failure");
    expect(storage.getStoreSnapshot().sessions).toHaveLength(0);expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
    await preparePublicRealtimeSession(id,owner,input,new Date());expect(storage.getStoreSnapshot().sessions).toHaveLength(1);
  });
  it.each(["qwen","openai"])("issues %s's server rate, signs the same lease and reuses one bounded hold",async vendor=>{
    await prepared(vendor);await grant();
    const [first,second]=await Promise.all([issuePublicRealtimeSession(id,owner),issuePublicRealtimeSession(id,owner)]);
    expect(second).toEqual(first);vi.setSystemTime(now.getTime()+5000);expect(await issuePublicRealtimeSession(id,owner)).toEqual(first);
    expect(first).toMatchObject({captureSampleRate:vendor==="qwen"?16000:24000,ownerId:owner,deploymentId:"runtime-test",maxDurationSeconds:60});
    const claims=verifyRealtimeToken(first.realtimeToken,signing)!;expect(claims).not.toBeNull();
    expect(publicRuntimeTokenBinding(claims,"runtime-test")).toMatchObject({sampleRate:first.captureSampleRate,leaseId:current().publicRuntimePolicy!.leaseId,
      captureId:current().publicRuntimePolicy!.captureId,configurationHash:current().publicModelConfiguration!.configurationHash});
    expect(claims.asrEndpointMode).toBe("listening");expect(claims.processing!.syncPermission).toEqual({allowed:false});
    expect(storage.getStoreSnapshot().usageHolds).toHaveLength(1);expect(storage.getStoreSnapshot().usageHolds[0]).toMatchObject({status:"active",seconds:30});
    expect(storage.getStoreSnapshot().billingLedger).toHaveLength(0);
    const stored=JSON.stringify(current());expect(stored).not.toContain(first.realtimeToken);expect(stored).not.toContain(signing);expect(stored).not.toContain("SYNTHETIC_RUNTIME_SECRET");
  });
  it("binds configured speech voice when enabled without selecting a private voice",async()=>{
    await prepared("qwen",true);await grant();const response=await issuePublicRealtimeSession(id,owner),claims=verifyRealtimeToken(response.realtimeToken,signing)!;
    expect(claims.voice).toEqual({mode:"preset",presetId:"manual-voice"});expect(claims.processing!.executionPlan.tts.execution).toBe("public");
  });
  it.each(["owner","language","untrusted_rate","untrusted_grant","speaker","voice"])("rejects %s mismatch without overwriting or reserving quota",async kind=>{
    const input=await prepared();const before=structuredClone(current());
    const next: any=structuredClone(input);
    if(kind==="language"){next.targetLanguage="ja";next.processing.languagePolicy.target="ja";}
    if(kind==="untrusted_rate")next.captureSampleRate=24000;if(kind==="untrusted_grant")next.publicGrantRef="forged";
    if(kind==="speaker")next.speakerAttribution={mode:"diarization"};if(kind==="voice")next.voice={mode:"personal_clone",voiceProfileId:"other"};
    await expect(Promise.resolve().then(()=>preparePublicRealtimeSession(id,kind==="owner"?"other":owner,next,new Date()))).rejects.toThrow();
    expect(current()).toEqual(before);expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it("rejects finalized ASR protocol before preparing a continuous session",async()=>{
    const input=await request(),update=body(2);Object.assign(update.components.asr,{protocol:"qwen_asr_compatible",endpoint:"https://synthetic.invalid/v1"});
    await savePublicModelConfiguration(update);const config=capturePublicModelRuntimeConfiguration(false);
    input.processing.modelPolicyRevision=config.modelPolicyRevision;input.processing.executionPlan=config.executionPlan;
    await expect(Promise.resolve().then(()=>preparePublicRealtimeSession(id,owner,input,new Date()))).rejects.toThrow("not_continuous");
    expect(storage.getStoreSnapshot().sessions).toHaveLength(0);
  });
  it.each(["missing_signer","insecure_endpoint","revoked","changed_config","wrong_owner","terminal"])("blocks %s before issuance",async reason=>{
    await prepared();await grant();
    if(reason==="missing_signer")vi.stubEnv("REALTIME_TOKEN_SECRET","");if(reason==="insecure_endpoint")vi.stubEnv("REALTIME_WS_ENDPOINT","ws://private.invalid");
    if(reason==="revoked")await revokePublicInferenceEvidence(id,owner,"consent",new Date());
    if(reason==="changed_config")await savePublicModelConfiguration(body(2));if(reason==="terminal")current().status="ended";
    await expect(issuePublicRealtimeSession(id,reason==="wrong_owner"?"other":owner)).rejects.toThrow();
    expect(current()).not.toHaveProperty("publicRealtimeIssuance");expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it("rejects customer quota exhaustion independently of provider budget",async()=>{
    await prepared();await grant();await holds.getUsageBalance(owner);storage.getStoreSnapshot().usageBalances[owner]=0;
    await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow("quota_not_enough");expect(current()).not.toHaveProperty("publicRealtimeIssuance");
    expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it.each([{sampleRate:24000},{languagePolicyKey:"other"},{maxActiveSeconds:999},{captureId:""},{expiresAt:"2099-01-01T00:00:00.000Z"}])("refuses an altered existing lease before quota %j",async patch=>{
    await prepared();await grant();await issuePublicRuntimeLease(id,owner,new Date());Object.assign(current().publicRuntimePolicy!,patch);
    await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow("lease_conflict");expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it.each(["released","settled"])("does not mistake an idempotent %s hold for usable quota",async status=>{
    await prepared();await grant();await issuePublicRealtimeSession(id,owner);(storage.getStoreSnapshot().usageHolds[0] as any).status=status;
    await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow("hold_invalid");expect(storage.getStoreSnapshot().usageHolds).toHaveLength(1);
  });
  it("returns the same token after a failed issuance persistence, without extra quota or a stored bearer",async()=>{
    await prepared();await grant();const persist=storage.persistStoreSnapshot;let fail=true;
    vi.spyOn(storage,"persistStoreSnapshot").mockImplementation(()=>{if(fail&&current().publicRealtimeIssuance){fail=false;throw Error("synthetic storage failure");}return persist();});
    await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow("synthetic storage failure");expect(current()).not.toHaveProperty("publicRealtimeIssuance");
    expect(storage.getStoreSnapshot().usageHolds).toHaveLength(1);
    const response=await issuePublicRealtimeSession(id,owner);expect(response.realtimeToken).toBeTruthy();expect(storage.getStoreSnapshot().usageHolds).toHaveLength(1);
  });
  it("rechecks revocation after awaiting the customer hold and never issues a stale grant",async()=>{
    await prepared();await grant();const create=holds.createUsageHold;
    vi.spyOn(holds,"createUsageHold").mockImplementation(async(...args)=>{const result=await create(...args);await revokePublicInferenceEvidence(id,owner,"consent",new Date());return result;});
    await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow();expect(current()).not.toHaveProperty("publicRealtimeIssuance");
    expect(storage.getStoreSnapshot().usageHolds).toHaveLength(1);expect(Date.parse(storage.getStoreSnapshot().usageHolds[0].expiresAt)).toBeLessThanOrEqual(Date.parse(current().publicRuntimePolicy!.expiresAt));
  });
  it("does not extend token expiry, renew the lease or reserve again after the issue window",async()=>{
    await prepared();await grant();await issuePublicRealtimeSession(id,owner);const lease=structuredClone(current().publicRuntimePolicy);
    vi.setSystemTime(now.getTime()+301000);await expect(issuePublicRealtimeSession(id,owner)).rejects.toThrow("expired");
    expect(current().publicRuntimePolicy).toEqual(lease);expect(storage.getStoreSnapshot().usageHolds).toHaveLength(1);
  });
  it.each(["qwen","openai"])("passes signed %s claims into original Gateway assembly and rejects a changed capture binding",async vendor=>{
    await prepared(vendor);await grant();const response=await issuePublicRealtimeSession(id,owner),claims=verifyRealtimeToken(response.realtimeToken,signing)!;
    const snapshot=current().publicModelConfiguration!,lease=current().publicRuntimePolicy!;
    const authorizeConnection=vi.fn(async()=>{verifiedPublicAdmission(current(),owner,new Date());});
    const recordAttempt=vi.fn(async(event:PublicModelAttemptEvent)=>{await recordPublicModelAttempt(id,event,new Date());});
    const socketFactory=vi.fn(()=>{const socket=vendor==="qwen"?new SyntheticQwenAsrSocket():new SyntheticAsrSocket();socket.transcript="今天我们测试在线语音翻译。";return socket.asWebSocket();});
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Today we test online speech translation."}}]})));
    const options={snapshot,authorization:current().processingAuthorization!,binding:{sessionId:id,ownerId:owner,deploymentId:"runtime-test",modelPolicyRevision:snapshot.modelPolicyRevision,
      leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,sampleRate:response.captureSampleRate!},
      session:{sessionId:id,userId:owner,sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false,asrEndpointMode:"listening" as const},
      authorizeConnection,recordAttempt,socketFactory,fetchFn,resolveAsrCredentials:createPublicModelCredentialResolver(snapshot,"asr"),
      resolveTranslationCredentials:createPublicModelCredentialResolver(snapshot,"translation")};
    const router=new ProviderRouter(),built=router.createConfiguredPublicSessionFromVerifiedClaims(options,claims);
    expect(socketFactory).not.toHaveBeenCalled();expect(authorizeConnection).not.toHaveBeenCalled();
    for(const change of [{captureId:"other"},{sampleRate:response.captureSampleRate===16000?24000:16000},{configurationHash:"b".repeat(64)}]){
      const forged={...claims,publicRuntime:{...claims.publicRuntime!,...change}};
      expect(()=>router.createConfiguredPublicSessionFromVerifiedClaims(options,forged as typeof claims)).toThrow("token_binding_mismatch");
    }
    const runtime={leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,phase:"active",finalRevision:0};
    await observePublicRuntime(id,{...runtime,sequence:1,lastAcceptedSample:0},new Date());
    await built.provider.createSession(options.session);vi.setSystemTime(now.getTime()+100);
    const samples=response.captureSampleRate!/10;
    await observePublicRuntime(id,{...runtime,sequence:2,lastAcceptedSample:samples},new Date());
    const frame:AudioFrame={type:"audio.frame",sessionId:id,sequence:1,timestampMs:0,format:"pcm16",sampleRate:response.captureSampleRate!,data:Buffer.alloc(samples*2).toString("base64")};
    markAcceptedAudioRange(frame,{startSample:0,endSample:samples});
    const events=[];try{
      for await(const event of built.provider.sendAudio(frame))events.push(event);
      for await(const event of built.provider.flushSession(id))events.push(event);
      expect(events).toContainEqual(expect.objectContaining({type:"transcript.final",language:"zh"}));
      expect(events).toContainEqual(expect.objectContaining({type:"translation.final",language:"en"}));
      expect(current().publicModelAttempts!.map(a=>[a.event.component,a.event.state])).toEqual([["asr","confirmed"],["translation","confirmed"]]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }finally{await built.provider.closeSession(id);}
  });
  it("does not open the public HTTP creation endpoint when internal issuance exists",async()=>{
    const input=await request();vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");const app=await buildApp();
    try{const r=await app.inject({method:"POST",url:"/realtime/sessions",payload:input});expect(r.statusCode).toBe(503);
      expect(storage.getStoreSnapshot().sessions).toHaveLength(0);expect(storage.getStoreSnapshot().usageHolds).toHaveLength(0);
    }finally{await app.close();}
  });
});
