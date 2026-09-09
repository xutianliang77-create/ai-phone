import {generateKeyPairSync} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {PublicAdmissionQuery} from "@translation/contracts";
import {publicRuntimeTokenBinding,redactLogObject} from "@translation/contracts";
import {buildApp} from "../../app.js";
import {installConfigurationFixture,current,now,evidence,body} from "../sessions/public-model-configuration.test-support.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {preparePublicRealtimeSession} from "./public-realtime-preparation.js";
import {issuePublicRealtimeSession} from "./public-realtime-issuer.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission,revokePublicInferenceEvidence} from "../sessions/public-inference-admission.service.js";
import {verifyRealtimeToken} from "../../../../realtime-gateway/src/auth/realtime-token-verifier.js";
import {createSessionEventSink} from "../../../../realtime-gateway/src/sessions/session-event-sink.js";
import {createPublicRuntimeMaterialClient} from "../../../../realtime-gateway/src/sessions/public-runtime-material-client.js";
import {observePublicRuntime} from "../sessions/public-session-runtime.service.js";
import {createPublicAdmissionClient} from "../../../../realtime-gateway/src/sessions/public-admission-client.js";
import type {RealtimeEnv} from "../../../../realtime-gateway/src/config/env.js";
const signer="SYNTHETIC_MATERIAL_SIGNER_NOT_REAL",internal="SYNTHETIC_INTERNAL_MATERIAL_SECRET",access="SYNTHETIC_SEPARATE_CREDENTIAL_ACCESS";
let app:FastifyInstance,q:PublicAdmissionQuery,issued:Awaited<ReturnType<typeof issuePublicRealtimeSession>>;
installConfigurationFixture();
async function issue(){
  const config=capturePublicModelRuntimeConfiguration(false);
  getStoreSnapshot().sessions=[];
  await preparePublicRealtimeSession("material-session","owner",{mode:"conversation",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,speakerAttribution:{mode:"off"},
    processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:config.modelPolicyRevision,executionPlan:config.executionPlan,languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncRequested:false}},new Date());
  for(const e of evidence())await recordPublicInferenceEvidence(current().id,current().userId,e,new Date());
  await writePublicInferenceAdmission(current().id,current().userId,{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}},new Date());
  issued=await issuePublicRealtimeSession(current().id,current().userId);
  const claims=verifyRealtimeToken(issued.realtimeToken,signer)!;
  q={...publicRuntimeTokenBinding(claims,"runtime-test")!,contractVersion:1,requestId:"material-query",purpose:"connect",sessionId:current().id,ownerId:current().userId,modelPolicyRevision:config.modelPolicyRevision,grantRef:claims.processing!.publicGrantRef!};
}
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);vi.stubEnv("REALTIME_TOKEN_SECRET",signer);vi.stubEnv("INTERNAL_API_SECRET",internal);vi.stubEnv("REALTIME_WS_ENDPOINT","wss://gateway.synthetic.invalid");
  const store=getStoreSnapshot();store.usageHolds=[];store.billingLedger=[];store.usageBalances={};store.usagePlanCodes={};
  await issue();app=await buildApp({publicGatewayCredentialAccess:{secret:access}});
});
afterEach(async()=>{await app.close();vi.useRealTimers();});
const headers={authorization:`Bearer ${internal}`,"x-wujie-gateway-credential":access};
const request=(kind:"configuration"|"credentials",payload:unknown=kind==="configuration"?q:{query:q,component:"asr"},auth:Record<string,string>=headers)=>
  app.inject({method:"POST",url:`/internal/realtime/sessions/${q.sessionId}/${kind}`,headers:auth,payload:payload as any});
describe("session-scoped server runtime materials",()=>{
  async function disconnected(){
    const p=current().publicRuntimePolicy!,base={leaseId:p.leaseId,captureId:p.captureId,languagePolicyKey:p.languagePolicyKey};
    await observePublicRuntime(q.sessionId,{...base,sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0},now);
    vi.setSystemTime(now.getTime()+1000);
    await observePublicRuntime(q.sessionId,{...base,sequence:2,phase:"disconnected",finalRevision:1,lastAcceptedSample:3200},new Date());
    return {...q,purpose:"recovery" as const};
  }
  const inspect=(value:PublicAdmissionQuery)=>app.inject({method:"POST",url:`/internal/realtime/sessions/${q.sessionId}/admission`,headers:{authorization:`Bearer ${internal}`},payload:value});
  it("inspects the exact original recovery watermark through the API sink without changing any aggregate",async()=>{
    const value=await disconnected(),before=structuredClone(getStoreSnapshot()),calls:string[]=[];
    const fetchFn=vi.fn(async(url:any,init:any)=>{calls.push(new URL(String(url)).pathname);const r=await app.inject({method:"POST",url:calls.at(-1)!,headers:init.headers,payload:JSON.parse(init.body)});return new Response(r.body,{status:r.statusCode});});
    const claims=verifyRealtimeToken(issued.realtimeToken,signer)!;
    const client=createPublicAdmissionClient(createSessionEventSink({sessionEventSink:"api",apiBaseUrl:"https://api.synthetic.invalid",internalApiSecret:internal,sessionSyncTimeoutMs:250} as RealtimeEnv,fetchFn),claims,"runtime-test");
    const a=await client.inspectRecovery(),b=await client.inspectRecovery();
    expect(a).toMatchObject({purpose:"recovery",status:"paused",recovery:{runtimeSequence:2,lastAcceptedSample:3200,finalRevision:1,activeMs:1000,recoveryUntil:new Date(now.getTime()+301000).toISOString()}});
    expect(a.requestId).not.toBe(b.requestId);expect(getStoreSnapshot()).toEqual(before);
    expect(calls.every(p=>p.endsWith('/admission'))).toBe(true);expect(JSON.stringify(a)).not.toMatch(/realtimeToken|apiKey|SYNTHETIC|credentials/);
    expect((await inspect({...value,purpose:"connect"})).statusCode).toBe(403);
    expect((await inspect({...value,purpose:"dispatch"})).statusCode).toBe(403);
  });
  it.each(["asr","translation","tts"])("recovery lookup never authorizes %s credentials or configuration",async component=>{
    const value=await disconnected();expect((await request("credentials",{query:value,component})).statusCode).toBe(403);
    expect((await request("configuration",value)).statusCode).toBe(403);
  });
  it("Gateway material client refuses recovery-purpose credentials before any transport",async()=>{
    const credentials=vi.fn(async()=>({})),configuration=vi.fn(async()=>({}));
    const client=createPublicRuntimeMaterialClient({record:async()=>{},touch:async()=>{},credentials,configuration},verifyRealtimeToken(issued.realtimeToken,signer)!,"runtime-test",access);
    await expect(client.credentials("asr","recovery" as any)).rejects.toThrow("public_recovery_material_denied");
    expect(credentials).not.toHaveBeenCalled();expect(configuration).not.toHaveBeenCalled();
  });
  it.each(["active","paused","uncertain","stopped","terminal","revoked","window","spent","sequence","sample","revision","clock","inflatedWindow"])("rejects ineligible recovery %s without mutating it",async reason=>{
    const value=await disconnected(),s=current(),r=s.publicRuntime!;
    if(reason==="active"){s.status="active";r.phase="active";}if(reason==="paused")r.phase="paused";if(reason==="uncertain")r.uncertain=true;
    if(reason==="stopped")r.stoppedAt=new Date().toISOString();if(reason==="terminal")s.status="failed";if(reason==="revoked")s.publicInferenceAdmission!.revokedAt=new Date().toISOString();
    if(reason==="window")vi.setSystemTime(now.getTime()+301000);if(reason==="spent")r.activeMs=60000;if(reason==="sequence")r.sequence=0;
    if(reason==="sample")r.lastAcceptedSample=-1;if(reason==="revision")r.finalRevision=.5;if(reason==="clock")r.observedAt=new Date(Date.now()+1).toISOString();
    if(reason==="inflatedWindow")r.recoveryUntil=new Date(now.getTime()+302000).toISOString();
    const before=structuredClone(getStoreSnapshot());expect((await inspect(value)).statusCode).toBeGreaterThanOrEqual(400);expect(getStoreSnapshot()).toEqual(before);
  });
  it("clamps the recovery deadline to the existing lease and does not refresh the handshake token",async()=>{
    const p=current().publicRuntimePolicy!,base={leaseId:p.leaseId,captureId:p.captureId,languagePolicyKey:p.languagePolicyKey};
    const original=structuredClone(current().publicRealtimeIssuance);
    await observePublicRuntime(q.sessionId,{...base,sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0},now);
    await observePublicRuntime(q.sessionId,{...base,sequence:2,phase:"paused",finalRevision:0,lastAcceptedSample:0},new Date(now.getTime()+1000));
    vi.setSystemTime(now.getTime()+400000);
    await observePublicRuntime(q.sessionId,{...base,sequence:3,phase:"disconnected",finalRevision:0,lastAcceptedSample:0},new Date());
    const response=await inspect({...q,purpose:"recovery"});expect(response.statusCode).toBe(200);
    expect(response.json().recovery).toMatchObject({runtimeSequence:3,activeMs:1000,recoveryUntil:p.expiresAt});
    expect(current().publicRealtimeIssuance).toEqual(original);
  });
  it("rejects a recovery checkpoint after configuration rotation",async()=>{
    const value=await disconnected();await savePublicModelConfiguration(body(1));
    const before=structuredClone(getStoreSnapshot());expect((await inspect(value)).statusCode).toBe(409);expect(getStoreSnapshot()).toEqual(before);
  });
  it("returns a credential-free exact configuration but requires an independent capability for credentials",async()=>{
    const before=structuredClone(getStoreSnapshot()),configuration=await request("configuration",q,{authorization:`Bearer ${internal}`});
    expect(configuration.statusCode).toBe(200);expect(configuration.json().configuration).toEqual(current().publicModelConfiguration);
    expect(configuration.body).not.toMatch(/SYNTHETIC|apiKey|serviceAccountJson/);expect(configuration.headers["cache-control"]).toBe("no-store");
    expect((await request("credentials",undefined,{authorization:`Bearer ${internal}`})).statusCode).toBe(403);
    const allowed=await request("credentials");expect(allowed.statusCode).toBe(200);expect(Object.keys(allowed.json().credentials)).toEqual(["apiKey"]);
    expect(getStoreSnapshot()).toEqual(before);
  });
  it("does not enable credential access in the default API startup",async()=>{
    await app.close();app=await buildApp();expect((await request("credentials")).statusCode).toBe(503);
  });
  it.each(["wrong_owner","wrong_config","revoked","wrong_secret","missing_internal","tts_disabled","mt_before_start"])("rejects %s before handing out credentials",async kind=>{
    const query=structuredClone(q),auth={...headers};let component="asr";
    if(kind==="wrong_owner")query.ownerId="other";if(kind==="wrong_config")query.configurationHash="b".repeat(64);
    if(kind==="revoked")await revokePublicInferenceEvidence(q.sessionId,q.ownerId,"consent",new Date());
    if(kind==="wrong_secret")auth["x-wujie-gateway-credential"]="wrong";if(kind==="missing_internal")auth.authorization="";
    if(kind==="tts_disabled")component="tts";if(kind==="mt_before_start")component="translation";
    const response=await request("credentials",{query,component},auth);expect(response.statusCode).toBeGreaterThanOrEqual(400);expect(response.body).not.toContain("SYNTHETIC_RUNTIME_SECRET");
  });
  it("rejects forwarded HTTPS on an untrusted plaintext peer",async()=>{
    const r=await app.inject({method:"POST",url:`/internal/realtime/sessions/${q.sessionId}/credentials`,payload:{query:q,component:"asr"},headers:{...headers,"x-forwarded-proto":"https"},remoteAddress:"203.0.113.42"});
    expect(r.statusCode).toBe(403);
  });
  it("redacts the separate access header and Tencent secret fields",()=>{
    expect(JSON.stringify(redactLogObject({headers:{"x-wujie-gateway-credential":access},secretId:"SYNTHETIC_ID",secretKey:"SYNTHETIC_KEY"}))).not.toContain("SYNTHETIC");
  });
  it("keeps service-account JSON on API and reuses its scoped short-lived token",async()=>{
    const update=body(1),privateKey=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
    Object.assign(update.components.asr,{vendor:"google",protocol:"google_speech_v2",authKind:"google_service_account",endpoint:"https://speech.googleapis.com",projectId:"synthetic-project",location:"global",recognizer:"_",modelId:"long",languageLocales:{zh:"cmn-Hans-CN"}});
    (update.credentials as any).asr={serviceAccountJson:JSON.stringify({type:"service_account",project_id:"synthetic-project",client_email:"synthetic@invalid.test",private_key:privateKey})};
    await savePublicModelConfiguration(update);getStoreSnapshot().usageHolds=[];await issue();
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({access_token:"SYNTHETIC_ACCESS_TOKEN",token_type:"Bearer",expires_in:3600})));
    await app.close();app=await buildApp({publicGatewayCredentialAccess:{secret:access,fetchFn}});
    for(let i=0;i<2;i++){const r=await request("credentials");expect(r.statusCode).toBe(200);expect(r.body).not.toContain(privateKey);expect(r.body).not.toContain("serviceAccountJson");expect(r.json().credentials.accessToken).toBe("SYNTHETIC_ACCESS_TOKEN");}
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("validates configuration hashes and credentials again on Gateway without caching raw keys",async()=>{
    const fetchFn=vi.fn(async(url:any,init:any)=>{const response=await app.inject({method:"POST",url:new URL(String(url)).pathname,headers:init.headers,payload:JSON.parse(init.body)});return new Response(response.body,{status:response.statusCode});});
    const sink=createSessionEventSink({sessionEventSink:"api",apiBaseUrl:"https://api.synthetic.invalid",internalApiSecret:internal,sessionSyncTimeoutMs:1000} as RealtimeEnv,fetchFn);
    const claims=verifyRealtimeToken(issued.realtimeToken,signer)!,client=createPublicRuntimeMaterialClient(sink,claims,"runtime-test",access);
    await expect(client.credentials("asr","connect")).rejects.toThrow("disabled");expect(fetchFn).not.toHaveBeenCalled();
    await client.configuration();expect((await client.credentials("asr","connect")).apiKey).toBeTruthy();
    await revokePublicInferenceEvidence(q.sessionId,q.ownerId,"consent",new Date());await expect(client.credentials("asr","connect")).rejects.toThrow();
  });
  it.each(["configuration","credentials"])("rejects tampered %s material at Gateway",async kind=>{
    const fetchFn=vi.fn(async(url:any,init:any)=>{const path=new URL(String(url)).pathname,response=await app.inject({method:"POST",url:path,headers:init.headers,payload:JSON.parse(init.body)}),value=response.json();
      if(kind==="configuration"&&value.configuration)value.configuration.components.asr.modelId="forged-model";
      if(kind==="credentials"&&value.credentials)value.credentials.serviceAccountJson="FORBIDDEN_RAW_PRIVATE_JSON";
      return new Response(JSON.stringify(value),{status:response.statusCode});});
    const sink=createSessionEventSink({sessionEventSink:"api",apiBaseUrl:"https://api.synthetic.invalid",internalApiSecret:internal,sessionSyncTimeoutMs:1000} as RealtimeEnv,fetchFn);
    const client=createPublicRuntimeMaterialClient(sink,verifyRealtimeToken(issued.realtimeToken,signer)!,"runtime-test",access);
    if(kind==="configuration")await expect(client.configuration()).rejects.toThrow("configuration_mismatch");
    else{await client.configuration();await expect(client.credentials("asr","connect")).rejects.toThrow("credentials_mismatch");}
  });
});
