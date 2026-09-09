import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import type {PublicAdmissionQuery} from "@translation/contracts";
import {publicRuntimeTokenBinding} from "@translation/contracts";
import {buildApp} from "../../app.js";
import {installConfigurationFixture,current,now,body} from "../sessions/public-model-configuration.test-support.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import * as storage from "../../infrastructure/storage/json-store.js";
import * as repositoryRuntime from "../../infrastructure/storage/repository-runtime.js";
import {normalizeStoreSnapshot} from "../../infrastructure/storage/json-store-snapshot.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {createPublicRealtimeCoordinator,type PublicRealtimeAuthority} from "./public-realtime-coordinator.js";
import type {PublicInferenceEvidence} from "../sessions/public-inference-evidence.js";
import {revokePublicInferenceEvidence} from "../sessions/public-inference-admission.service.js";
import {observePublicRuntime} from "../sessions/public-session-runtime.service.js";
import {verifyRealtimeToken} from "../../../../realtime-gateway/src/auth/realtime-token-verifier.js";
import {createSessionEventSink} from "../../../../realtime-gateway/src/sessions/session-event-sink.js";
import {createPublicAdmissionClient} from "../../../../realtime-gateway/src/sessions/public-admission-client.js";
import type {RealtimeEnv} from "../../../../realtime-gateway/src/config/env.js";
const signer="SYNTHETIC_PUBLIC_COORDINATOR_SIGNER",internal="SYNTHETIC_INTERNAL_GATEWAY_SECRET";
let app:FastifyInstance,authority:PublicRealtimeAuthority,resolve:ReturnType<typeof vi.fn>;
installConfigurationFixture();
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");vi.stubEnv("REALTIME_TOKEN_SECRET",signer);vi.stubEnv("REALTIME_WS_ENDPOINT","wss://gateway.synthetic.invalid/realtime");vi.stubEnv("INTERNAL_API_SECRET",internal);
  const s=getStoreSnapshot();s.sessions=[];s.usageHolds=[];s.billingLedger=[];s.usageBalances={};s.usagePlanCodes={};
  resolve=vi.fn<PublicRealtimeAuthority["resolveVerifiedEvidence"]>(async context=>{
    const common={sessionId:context.sessionId,ownerId:context.ownerId,deploymentId:context.deploymentId,processingHash:context.processingHash,
      region:"synthetic-region",providerPolicyRevision:context.configuration.modelPolicyRevision,sourceReceiptId:"synthetic-only",
      issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()};
    const components=["asr","translation"] as const;
    const records:PublicInferenceEvidence[]=[{...common,id:"consent",kind:"inference_consent",version:"public-inference-v1",components:[...components]},
      {...common,id:"budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,maxActiveSeconds:60,sampleRate:context.configuration.components.asr!.sampleRate},
      ...components.map(component=>({...common,id:component,kind:"model_qualification" as const,state:"qualified" as const,component,
        scopeKey:(context.configuration.executionPlan[component] as {scopeKey:string}).scopeKey,
        providerId:context.configuration.components[component]!.vendor,modelId:context.configuration.components[component]!.modelId}))];
    return {records,refs:{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}}};
  });
  authority={timeoutMs:1000,resolveVerifiedEvidence:resolve};app=await buildApp({publicRealtimeAuthority:authority});
});
afterEach(async()=>{await app.close();vi.useRealTimers();});
function input(){const config=capturePublicModelRuntimeConfiguration(false);return {mode:"conversation",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,speakerAttribution:{mode:"off"},
  processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:config.modelPolicyRevision,executionPlan:config.executionPlan,
    languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncRequested:false}};}
const post=(payload:unknown=input(),key="request-0001")=>app.inject({method:"POST",url:"/realtime/sessions",headers:{"idempotency-key":key},payload:payload as any});
const queryFor=(token:string,purpose:PublicAdmissionQuery["purpose"]="connect"):PublicAdmissionQuery=>{
  const claims=verifyRealtimeToken(token,signer)!;return {...publicRuntimeTokenBinding(claims,"runtime-test")!,contractVersion:1,requestId:"query-0001",purpose,
    sessionId:claims.sessionId,ownerId:claims.userId,modelPolicyRevision:claims.processing!.modelPolicyRevision,grantRef:claims.processing!.publicGrantRef!};
};
const lookup=(query:PublicAdmissionQuery,headers:Record<string,string>={authorization:`Bearer ${internal}`})=>app.inject({method:"POST",url:`/internal/realtime/sessions/${query.sessionId}/admission`,headers,payload:query});
describe("original HTTP public creation with an explicitly installed trusted authority",()=>{
  it("issues through the original route and survives concurrent and post-rebuild retries with one session/hold/source resolution",async()=>{
    const [a,b]=await Promise.all([post(),post()]);expect(a.statusCode).toBe(200);expect(b.json()).toEqual(a.json());expect(a.headers["cache-control"]).toBe("no-store");
    expect(a.json()).toMatchObject({ownerId:"guest-user",deploymentId:"runtime-test",captureSampleRate:16000});
    expect(resolve).toHaveBeenCalledTimes(1);expect(getStoreSnapshot().sessions).toHaveLength(1);expect(getStoreSnapshot().usageHolds).toHaveLength(1);
    await app.close();app=await buildApp({publicRealtimeAuthority:authority});expect((await post()).json()).toEqual(a.json());expect(resolve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(current())).not.toContain(a.json().realtimeToken);expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  });
  it("does not select another session when the same idempotency key changes its language",async()=>{
    expect((await post()).statusCode).toBe(200);const changed=input();changed.sourceLanguage="fr";changed.processing.languagePolicy.source="fr";
    expect((await post(changed)).statusCode).toBe(409);expect(getStoreSnapshot().sessions).toHaveLength(1);expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("scopes request identity by account rather than reusing another owner's session",async()=>{
    const coordinate=createPublicRealtimeCoordinator(authority),a=await coordinate("account-a","request-0001",input()),b=await coordinate("account-b","request-0001",input());
    expect(a.sessionId).not.toBe(b.sessionId);expect(a.ownerId).toBe("account-a");expect(b.ownerId).toBe("account-b");expect(getStoreSnapshot().sessions).toHaveLength(2);
  });
  it("retains a minimal retired identity after deletion and refuses same-key resurrection",async()=>{
    const response=(await post()).json(),id=response.sessionId;
    const deleted=await app.inject({method:"DELETE",url:`/sessions/${id}`});expect(deleted.statusCode).toBe(204);
    expect(getStoreSnapshot().sessions).toHaveLength(0);expect(getStoreSnapshot().publicCreationBindings).toHaveProperty(id);
    const restored=normalizeStoreSnapshot(JSON.parse(JSON.stringify(getStoreSnapshot())));expect(restored.publicCreationBindings).toEqual(getStoreSnapshot().publicCreationBindings);
    expect((await post()).statusCode).toBe(410);expect(getStoreSnapshot().sessions).toHaveLength(0);expect(resolve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(restored.publicCreationBindings)).not.toMatch(/sourceLanguage|Token|request-0001|SYNTHETIC/);
  });
  it("rolls back both the request binding and session when their transaction fails",async()=>{
    const persist=storage.persistStoreSnapshot;let fail=true;
    vi.spyOn(storage,"persistStoreSnapshot").mockImplementation(()=>{if(fail&&Object.keys(getStoreSnapshot().publicCreationBindings??{}).length){fail=false;throw Error("synthetic binding persistence failure");}return persist();});
    expect((await post()).statusCode).toBe(503);expect(getStoreSnapshot().sessions).toHaveLength(0);expect(getStoreSnapshot().publicCreationBindings).toEqual({});expect(resolve).not.toHaveBeenCalled();
    expect((await post()).statusCode).toBe(200);expect(getStoreSnapshot().sessions).toHaveLength(1);expect(Object.keys(getStoreSnapshot().publicCreationBindings!)).toHaveLength(1);
  });
  it("does not discard an invalid request binding while loading a snapshot",()=>{
    expect(()=>normalizeStoreSnapshot({...getStoreSnapshot(),publicCreationBindings:{invalid:"bad"}})).toThrow("Invalid public creation bindings");
  });
  it("does not pretend the new HTTP idempotency guard is wired to PostgreSQL",async()=>{
    const coordinate=createPublicRealtimeCoordinator(authority),value=input();
    vi.spyOn(repositoryRuntime,"getRepositoryRuntime").mockReturnValue({driver:"postgres"} as any);
    await expect(coordinate("owner","postgres-0001",value)).rejects.toThrow("postgres_idempotency_not_ready");expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["missing_key","forged_evidence","not_logged_in","insecure_transport"])("rejects %s before preparing or asking an authority",async reason=>{
    const payload:any=input();if(reason==="forged_evidence")payload.records=[{kind:"model_qualification",state:"qualified"}];
    if(reason==="not_logged_in")vi.stubEnv("API_TEST_AUTO_ACCOUNT","false");
    const r=await app.inject({method:"POST",url:"/realtime/sessions",payload,headers:reason==="missing_key"?{}:{"idempotency-key":"request-0001","x-forwarded-proto":"https"},
      ...(reason==="insecure_transport"?{remoteAddress:"203.0.113.42"}:{})});
    expect(r.statusCode).toBe(reason==="not_logged_in"?401:reason==="insecure_transport"?403:400);expect(resolve).not.toHaveBeenCalled();expect(getStoreSnapshot().sessions).toHaveLength(0);
  });
  it("retains the default production guard without a boot-time authority",async()=>{
    await app.close();app=await buildApp();expect((await post()).statusCode).toBe(503);expect(getStoreSnapshot().sessions).toHaveLength(0);expect(resolve).not.toHaveBeenCalled();
  });
  it("does not grant, reserve or leak an authority failure",async()=>{
    resolve.mockRejectedValue(Error("SENSITIVE_AUTHORITY_ERROR"));const r=await post();expect(r.statusCode).toBe(503);expect(r.body).not.toContain("SENSITIVE");
    expect(current()).not.toHaveProperty("publicInferenceAdmission");expect(getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it("validates all receipts before persisting any malformed authority bundle",async()=>{
    const original=resolve.getMockImplementation()!;
    resolve.mockImplementation(async(context,signal)=>{const result=await original(context,signal);result.records[1].ownerId="other";return result;});
    expect((await post()).statusCode).toBe(403);expect(current().publicInferenceEvidence).toBeUndefined();expect(getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it("cancels an in-flight authority and never persists its late reply",async()=>{
    let release!:(x:any)=>void;resolve.mockImplementation(()=>new Promise(r=>release=r));const controller=new AbortController(),coordinate=createPublicRealtimeCoordinator(authority);
    const p=coordinate("owner","cancel-0001",input(),controller.signal),check=expect(p).rejects.toThrow("cancelled");
    while(!release)await new Promise(r=>setImmediate(r));controller.abort();await check;release({records:[],refs:{}});await new Promise(r=>setImmediate(r));
    expect(current()).not.toHaveProperty("publicInferenceAdmission");expect(getStoreSnapshot().usageHolds).toHaveLength(0);
  });
  it("bounds a non-cooperative authority and permits an explicit same-key retry without another session",async()=>{
    const original=resolve.getMockImplementation()!;resolve.mockImplementation(()=>new Promise(()=>{}));
    const coordinate=createPublicRealtimeCoordinator({...authority,timeoutMs:250});
    await expect(coordinate("owner","timeout-0001",input())).rejects.toThrow("cancelled");
    expect(getStoreSnapshot().sessions).toHaveLength(1);expect(getStoreSnapshot().usageHolds).toHaveLength(0);
    resolve.mockImplementation(original);expect((await coordinate("owner","timeout-0001",input())).captureSampleRate).toBe(16000);
    expect(getStoreSnapshot().sessions).toHaveLength(1);expect(getStoreSnapshot().usageHolds).toHaveLength(1);
  });
});
describe("current admission lookup through the original internal API and Gateway sink",()=>{
  it("returns only read-only nonce-bound metadata and does not cache a grant",async()=>{
    const response=(await post()).json(),claims=verifyRealtimeToken(response.realtimeToken,signer)!,before=structuredClone(getStoreSnapshot());
    const fetchFn=vi.fn(async(url:any,init:any)=>{const r=await app.inject({method:"POST",url:new URL(String(url)).pathname,headers:init.headers,payload:JSON.parse(init.body)});return new Response(r.body,{status:r.statusCode});});
    const sink=createSessionEventSink({sessionEventSink:"api",apiBaseUrl:"https://api.synthetic.invalid",internalApiSecret:internal,sessionSyncTimeoutMs:500} as RealtimeEnv,fetchFn);
    const client=createPublicAdmissionClient(sink,claims,"runtime-test"),a=await client.authorize("connect"),b=await client.authorize("connect");
    expect(a.requestId).not.toBe(b.requestId);expect(a.allowed).toBe(true);expect(fetchFn).toHaveBeenCalledTimes(2);expect(getStoreSnapshot()).toEqual(before);
    const text=JSON.stringify(a);expect(text).not.toMatch(/apiKey|SYNTHETIC|realtimeToken/);
    await revokePublicInferenceEvidence(claims.sessionId,claims.userId,"consent",new Date());await expect(client.authorize("connect")).rejects.toThrow();expect(fetchFn).toHaveBeenCalledTimes(3);
  });
  it.each(["owner","lease","configuration","revoked","expired","no_internal_auth"])("rejects %s instead of returning a stale allowed receipt",async reason=>{
    const q=queryFor((await post()).json().realtimeToken);
    if(reason==="owner")q.ownerId="other";if(reason==="lease")q.leaseId="other";
    if(reason==="configuration")await savePublicModelConfiguration(body(1));
    if(reason==="revoked")await revokePublicInferenceEvidence(q.sessionId,q.ownerId,"consent",new Date());if(reason==="expired")vi.setSystemTime(now.getTime()+601000);
    const r=await lookup(q,reason==="no_internal_auth"?{}:undefined);expect(r.statusCode).toBeGreaterThanOrEqual(400);expect(r.body).not.toContain('"allowed":true');
  });
  it("separates initial connect from active dispatch and rejects stale or paused activity",async()=>{
    const q=queryFor((await post()).json().realtimeToken);expect((await lookup({...q,purpose:"dispatch"})).statusCode).toBe(403);
    const runtime={leaseId:q.leaseId,captureId:q.captureId,languagePolicyKey:q.languagePolicyKey,sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0};
    await observePublicRuntime(q.sessionId,runtime,new Date());expect((await lookup(q)).statusCode).toBe(403);
    expect((await lookup({...q,purpose:"dispatch"})).statusCode).toBe(200);
    current().processingAuthorization!.syncPermission={allowed:true,scopeId:"separate-text-sync"};
    expect((await lookup({...q,purpose:"dispatch"})).statusCode).toBe(200); // Text sync does not grant or revoke inference.
    current().publicRuntime!.uncertain=true;expect((await lookup({...q,purpose:"dispatch"})).statusCode).toBe(403);
    current().publicRuntime!.uncertain=false;vi.setSystemTime(now.getTime()+61000);expect((await lookup({...q,purpose:"dispatch"})).statusCode).toBe(403);
  });
});
