import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../../app.js";
import * as storage from "../../infrastructure/storage/json-store.js";
import * as runtime from "../../infrastructure/storage/repository-runtime.js";
import {normalizeStoreSnapshot} from "../../infrastructure/storage/json-store-snapshot.js";
import {installConfigurationFixture,current,now,evidence,body} from "../sessions/public-model-configuration.test-support.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {createPublicRealtimeCoordinator,type PublicRealtimeAuthority} from "./public-realtime-coordinator.js";
import {resolvePublicCreation} from "./public-creation-resolution.js";
import {publicCreationIdentity} from "./public-creation-binding.js";
import {preparePublicRealtimeSession} from "./public-realtime-preparation.js";
import {observePublicRuntime} from "../sessions/public-session-runtime.service.js";
import {createUsageHold} from "../usage/usage-hold-runtime.service.js";

installConfigurationFixture();
let app:FastifyInstance,authority:PublicRealtimeAuthority,source:ReturnType<typeof vi.fn>;
const store=storage.getStoreSnapshot,key="pending-request-0001",owner="guest-user";
const input=()=>{const c=capturePublicModelRuntimeConfiguration(false);return {mode:"conversation",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,speakerAttribution:{mode:"off"},
  processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:c.modelPolicyRevision,executionPlan:c.executionPlan,languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncRequested:false}};};
const request=()=>({request:input(),nonce:"resolution-0001"});
const route=(action:string,payload:unknown=request(),requestKey=key)=>app.inject({method:"POST",url:`/realtime/creation-requests/${action}`,headers:{"idempotency-key":requestKey},payload:payload as any});
const issue=()=>createPublicRealtimeCoordinator(authority)(owner,key,input());
const active=()=>{const p=current().publicRuntimePolicy!;return observePublicRuntime(current().id,{leaseId:p.leaseId,captureId:p.captureId,languagePolicyKey:p.languagePolicyKey,phase:"active",sequence:1,finalRevision:0,lastAcceptedSample:0},now);};
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");vi.stubEnv("REALTIME_TOKEN_SECRET","SYNTHETIC_CREATION_RESOLUTION_SIGNER");vi.stubEnv("REALTIME_WS_ENDPOINT","wss://gateway.synthetic.invalid/realtime");
  Object.assign(store(),{sessions:[],usageHolds:[],billingLedger:[],usageBalances:{},usagePlanCodes:{}});
  source=vi.fn(async()=>({records:evidence(),refs:{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}}}));
  authority={timeoutMs:1000,resolveVerifiedEvidence:source};app=await buildApp({publicRealtimeAuthority:authority});
});
afterEach(async()=>{await app.close();vi.useRealTimers();});

describe("public creation explicit query, cancellation and expiry",()=>{
  it("query is read-only and not-found alone never permits a fresh key",async()=>{
    const before=JSON.stringify(store()),r=await route("query");expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({state:"not_found",safeToReplace:false,canRetire:true,ownerId:owner,deploymentId:"runtime-test",nonce:"resolution-0001"});
    expect(JSON.stringify(store())).toBe(before);expect(source).not.toHaveBeenCalled();expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("cancel-before-arrival persists a tombstone, so late creation cannot resurrect the key",async()=>{
    const r=await route("cancel");expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({state:"cancelled",safeToReplace:true});
    expect(store().sessions).toHaveLength(0);await expect(issue()).rejects.toThrow("request_retired");expect(source).not.toHaveBeenCalled();
    expect((await route("cancel")).json()).toEqual(r.json());expect((await route("query")).json()).toEqual(r.json());
    const restored=normalizeStoreSnapshot(JSON.parse(JSON.stringify(store())));expect(restored.publicCreationBindings).toEqual(store().publicCreationBindings);
    await app.close();app=await buildApp({publicRealtimeAuthority:authority});expect((await route("query")).json().safeToReplace).toBe(true);
  });
  it("rejects changed content under a retired key and isolates another account",async()=>{
    await route("cancel");const other=request();other.request.sourceLanguage="fr";other.request.processing.languagePolicy.source="fr";
    expect((await route("cancel",other)).statusCode).toBe(409);
    expect(await resolvePublicCreation("another-owner",key,request(),"query")).toMatchObject({state:"not_found",safeToReplace:false});
  });
  it("cancels an issued but unstarted session, releases only its user hold, and rejects late runtime",async()=>{
    await issue();const before=store().billingLedger.length,claims=structuredClone(current().publicRealtimeIssuance!.claims);
    expect((await route("query")).json().state).toBe("issued");expect(store().usageHolds[0].status).toBe("active");
    expect((await route("cancel")).json()).toMatchObject({state:"cancelled",safeToReplace:true});
    expect(current().status).toBe("failed");expect(current().publicInferenceAdmission?.revokedAt).toBe(now.toISOString());
    expect(store().usageHolds[0].status).toBe("released");expect(store().billingLedger).toHaveLength(before);
    expect(current().publicRealtimeIssuance!.claims).toEqual(claims);expect(current().publicFinalization).toBeUndefined();
    await expect(active()).rejects.toThrow();await expect(issue()).rejects.toThrow("retired");
    expect((await route("cancel")).json().safeToReplace).toBe(true);expect(store().usageHolds).toHaveLength(1);
  });
  it("does not expire early; issued deadline permits explicit expiry without renewing token or charging",async()=>{
    await issue();expect((await route("expire")).statusCode).toBe(409);
    vi.setSystemTime(new Date(current().publicRealtimeIssuance!.claims.expiresAt*1000));
    const before=JSON.stringify(store());expect((await route("query")).json()).toMatchObject({state:"expired_pending",safeToReplace:false});expect(JSON.stringify(store())).toBe(before);
    expect((await route("expire")).json()).toMatchObject({state:"expired",safeToReplace:true});expect(store().usageHolds[0].status).toBe("released");expect(store().billingLedger).toHaveLength(0);
  });
  it("expires prepared-only requests after five server minutes, but not an absent request",async()=>{
    expect((await route("expire")).statusCode).toBe(409);
    const id=publicCreationIdentity(owner,key).sessionId;await preparePublicRealtimeSession(id,owner,input(),now);
    expect((await route("query")).json().state).toBe("prepared");vi.setSystemTime(new Date(now.getTime()+300000));
    expect((await route("expire")).json().state).toBe("expired");expect(store().usageHolds).toHaveLength(0);
  });
  it("old pending request can be cancelled after model configuration rotates",async()=>{
    const old=request();await issue();await savePublicModelConfiguration(body(1));
    expect((await route("cancel",old)).json().safeToReplace).toBe(true);expect(source).toHaveBeenCalledTimes(1);
  });
  it("serializes concurrent create and cancel, fencing later retries with one released hold",async()=>{
    const creating=issue(),cancel=resolvePublicCreation(owner,key,request(),"cancel");
    await creating;expect(await cancel).toMatchObject({state:"cancelled",safeToReplace:true});
    expect(store().sessions).toHaveLength(1);expect(store().usageHolds).toHaveLength(1);expect(store().usageHolds[0].status).toBe("released");
    await expect(issue()).rejects.toThrow("retired");
  });
  it("does not release a started session or falsely report a terminal receipt",async()=>{
    await issue();await active();const before=JSON.stringify(store());
    expect((await route("query")).json()).toMatchObject({state:"reconciliation_required",safeToReplace:false,canRetire:false});
    expect((await route("cancel")).statusCode).toBe(409);vi.setSystemTime(new Date(now.getTime()+600000));expect((await route("expire")).statusCode).toBe(409);
    expect(JSON.stringify(store())).toBe(before);expect(store().usageHolds[0].status).toBe("active");
  });
  it.each(["attempt","segment","consumed","settled","ledger","wrong_owner_hold","duplicate_hold","deleted_session"])("keeps %s evidence pending for original reconciliation",async reason=>{
    await issue();const s=current();
    if(reason==="attempt")s.publicModelAttempts=[{} as any];if(reason==="segment")s.segments=[{} as any];if(reason==="consumed")s.consumedSeconds=1;
    if(reason==="settled")store().usageHolds[0].status="settled";if(reason==="ledger")store().billingLedger.push({sessionId:s.id} as any);
    if(reason==="wrong_owner_hold")store().usageHolds[0].userId="other";if(reason==="duplicate_hold")store().usageHolds.push({...store().usageHolds[0],id:"duplicate"});
    if(reason==="deleted_session")store().sessions=[];
    const before=JSON.stringify(store());expect((await route("cancel")).statusCode).toBe(409);expect((await route("query")).json().safeToReplace).toBe(false);expect(JSON.stringify(store())).toBe(before);
  });
  it("rolls back hold, terminal state and tombstone together on a persist failure",async()=>{
    await issue();const before=structuredClone(store()),persist=storage.persistStoreSnapshot;
    vi.spyOn(storage,"persistStoreSnapshot").mockImplementation(()=>{if(store().publicCreationBindings?.[current().id]?.startsWith("cancelled:"))throw Error("synthetic disk failure");return persist();});
    expect((await route("cancel")).statusCode).toBe(503);expect(store()).toEqual(before);
  });
  it("retires a pre-issuance hold left by an interrupted issuer without creating a settlement",async()=>{
    const id=publicCreationIdentity(owner,key).sessionId;await preparePublicRealtimeSession(id,owner,input(),now);
    await createUsageHold(owner,30,{sessionId:id,idempotencyKey:`hold:${id}`});expect((await route("cancel")).json().safeToReplace).toBe(true);
    expect(store().usageHolds[0].status).toBe("released");expect(store().billingLedger).toHaveLength(0);
  });
  it("fails closed for corrupt retirement index and PostgreSQL",async()=>{
    expect(()=>normalizeStoreSnapshot({...store(),publicCreationBindings:{[publicCreationIdentity(owner,key).sessionId]:"cancelled:bad"}})).toThrow("Invalid public creation bindings");
    vi.spyOn(runtime,"getRepositoryRuntime").mockReturnValue({driver:"postgres"} as any);
    await expect(resolvePublicCreation(owner,key,request(),"query")).rejects.toMatchObject({status:503,code:"public_creation_postgres_idempotency_not_ready"});
  });
  it.each(["no_account","insecure","no_key","extra_body","no_nonce","disabled"])("retains %s boundary",async reason=>{
    const payload:any=request();if(reason==="extra_body")payload.ownerId="other";if(reason==="no_nonce")delete payload.nonce;
    if(reason==="no_account")vi.stubEnv("API_TEST_AUTO_ACCOUNT","false");
    if(reason==="disabled"){await app.close();app=await buildApp();}
    const r=await app.inject({method:"POST",url:"/realtime/creation-requests/cancel",payload,headers:reason==="no_key"?{}:{"idempotency-key":key},...(reason==="insecure"?{remoteAddress:"203.0.113.5"}:{})});
    expect(r.statusCode).toBe(reason==="no_account"?401:reason==="insecure"?403:reason==="disabled"?503:400);expect(store().publicCreationBindings).toEqual({});expect(source).not.toHaveBeenCalled();
  });
  it("an authority that resolves after timeout cannot resurrect a cancelled preparation",async()=>{
    let finish!:(value:any)=>void;
    const slow=createPublicRealtimeCoordinator({timeoutMs:250,resolveVerifiedEvidence:()=>new Promise(resolve=>{finish=resolve;})});
    const creating=slow(owner,key,input());const failed=expect(creating).rejects.toThrow("cancelled");
    await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));const late={records:evidence(),refs:{consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}}};
    const cancel=resolvePublicCreation(owner,key,request(),"cancel");await failed;expect(await cancel).toMatchObject({state:"cancelled",safeToReplace:true});
    finish(late);await new Promise(resolve=>setTimeout(resolve,0));expect(current().status).toBe("failed");expect(current().publicInferenceAdmission).toBeUndefined();expect(store().usageHolds).toHaveLength(0);
  });
  it("a failed public session cannot accept the first active observation even if its admission is otherwise valid",async()=>{
    await issue();current().status="failed";await expect(active()).rejects.toThrow("public_runtime_terminal");expect(current().publicRuntime).toBeUndefined();
  });
});
