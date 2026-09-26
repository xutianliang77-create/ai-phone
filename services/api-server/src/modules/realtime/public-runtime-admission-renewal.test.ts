import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {publicRuntimeTokenBinding,type PublicRuntimeObservation} from "@translation/contracts";
import {buildApp} from "../../app.js";
import {installConfigurationFixture,current,now,body} from "../sessions/public-model-configuration.test-support.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {createPublicRealtimeCoordinator,type PublicRealtimeAuthority} from "./public-realtime-coordinator.js";
import {createPublicRuntimeAdmissionRenewer} from "./public-runtime-admission-renewal.js";
import {observePublicRuntime} from "../sessions/public-session-runtime.service.js";
import {revokePublicInferenceEvidence} from "../sessions/public-inference-admission.service.js";
import {queryPublicAdmission} from "./public-admission-query.service.js";
import type {PublicInferenceEvidence} from "../sessions/public-inference-evidence.js";

const internal="SYNTHETIC_RENEWAL_INTERNAL_SECRET";
let app:FastifyInstance,authority:PublicRealtimeAuthority,resolve:ReturnType<typeof vi.fn<PublicRealtimeAuthority["resolveVerifiedEvidence"]>>;
installConfigurationFixture();
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");vi.stubEnv("REALTIME_TOKEN_SECRET","SYNTHETIC_RENEWAL_SIGNER");
  vi.stubEnv("REALTIME_WS_ENDPOINT","wss://gateway.synthetic.invalid/realtime");vi.stubEnv("INTERNAL_API_SECRET",internal);
  const store=getStoreSnapshot();store.sessions=[];store.usageHolds=[];store.billingLedger=[];store.usageBalances={};store.usagePlanCodes={};
  resolve=vi.fn(async context=>{
    const common={sessionId:context.sessionId,ownerId:context.ownerId,deploymentId:context.deploymentId,processingHash:context.processingHash,
      region:"synthetic-region",providerPolicyRevision:context.configuration.modelPolicyRevision,sourceReceiptId:"synthetic-policy",
      issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90_000).toISOString()};
    const records:PublicInferenceEvidence[]=[{...common,id:"budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,
      sampleRate:context.configuration.components.asr!.sampleRate},...["asr","translation"].map(component=>{
        const c=component as "asr"|"translation",execution=context.configuration.executionPlan[c];
        if(execution.execution!=="public")throw Error("synthetic_scope");
        return {...common,id:c,kind:"model_qualification" as const,state:"qualified" as const,component:c,
          scopeKey:execution.scopeKey,providerId:context.configuration.components[c]!.vendor,modelId:context.configuration.components[c]!.modelId};
      })];
    return {records,refs:{consentReceiptId:"ignored",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"translation"}}};
  });
  authority={timeoutMs:250,resolveVerifiedEvidence:resolve};
  app=await buildApp({publicRealtimeAuthority:authority});
});
afterEach(async()=>{await app.close();vi.useRealTimers();});
async function start(){
  const config=capturePublicModelRuntimeConfiguration(false);
  const result=await createPublicRealtimeCoordinator(authority)("guest-user","renewal-session-1",{mode:"conversation",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,speakerAttribution:{mode:"off"},
    processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:config.modelPolicyRevision,executionPlan:config.executionPlan,
      languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncRequested:false}});
  await observePublicRuntime(result.sessionId,event());
  return structuredClone(current());
}
function event():PublicRuntimeObservation{
  const s=current(),p=s.publicRuntimePolicy!,r=s.publicRuntime;
  return {leaseId:p.leaseId,captureId:p.captureId,languagePolicyKey:p.languagePolicyKey,phase:"active",sequence:(r?.sequence??0)+1,
    finalRevision:r?.finalRevision??0,lastAcceptedSample:r?.lastAcceptedSample??0};
}
function lookup(){
  const s=current(),claims=s.publicRealtimeIssuance!.claims;
  return queryPublicAdmission(s.id,{...publicRuntimeTokenBinding(claims,"runtime-test")!,contractVersion:1,requestId:"query-renewal-1",
    sessionId:s.id,ownerId:s.userId,modelPolicyRevision:claims.processing!.modelPolicyRevision,grantRef:claims.processing!.publicGrantRef!,purpose:"dispatch"});
}
function runtime(payload:unknown=event(),headers:Record<string,string>={authorization:`Bearer ${internal}`}){
  return app.inject({method:"POST",url:`/internal/realtime/sessions/${current().id}/runtime`,headers,payload:payload as any});
}
describe("same-session admission renewal through original runtime confirmation",()=>{
  it("crosses the original expiry with one session, unchanged JWT/hold/lease and continuous watermarks",async()=>{
    const before=await start(),hold=structuredClone(getStoreSnapshot().usageHolds);
    for(const seconds of [30,60,91]){
      vi.setSystemTime(now.getTime()+seconds*1000);
      const response=await runtime({...event(),lastAcceptedSample:seconds*16000});expect(response.statusCode).toBe(200);
    }
    expect(current().publicRuntimePolicy!.expiresAt>before.publicRuntimePolicy!.expiresAt).toBe(true);
    expect(current().publicRuntimePolicy).toMatchObject({leaseId:before.publicRuntimePolicy!.leaseId,captureId:before.publicRuntimePolicy!.captureId,
      languagePolicyKey:before.publicRuntimePolicy!.languagePolicyKey,renewal:{revision:3}});
    expect(current().publicRuntime).toMatchObject({activeMs:91000,lastAcceptedSample:91*16000,uncertain:false,sequence:4});
    expect(current().publicRealtimeIssuance).toEqual(before.publicRealtimeIssuance);
    expect(current().processingAuthorization).toEqual(before.processingAuthorization);
    expect(current().publicInferenceAdmission!.grantRef).toBe(before.publicInferenceAdmission!.grantRef);
    expect(current().publicInferenceEvidence).toHaveLength(4);
    expect(getStoreSnapshot().usageHolds).toEqual(hold);expect(getStoreSnapshot().billingLedger).toEqual([]);
    expect(getStoreSnapshot().sessions).toHaveLength(1);await expect(lookup()).resolves.toMatchObject({allowed:true,status:"active"});
  });
  it("keeps the admission query read-only and only the runtime write can refresh",async()=>{
    await start();vi.setSystemTime(now.getTime()+1000);const before=structuredClone(current());
    await lookup();expect(current()).toEqual(before);expect(resolve).toHaveBeenCalledTimes(1);
    expect((await runtime()).statusCode).toBe(200);expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("does not persist a non-extending proof and makes a duplicate runtime retry idempotent",async()=>{
    await start();const old=structuredClone(current().publicRuntimePolicy),first=event();
    expect((await runtime(first)).statusCode).toBe(200);expect(current().publicRuntimePolicy).toEqual(old);
    expect((await runtime(first)).statusCode).toBe(200);expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("keeps a still-valid grant when early refresh is unavailable, but refuses expired evidence",async()=>{
    await start();resolve.mockRejectedValue(Error("no_current_policy"));vi.setSystemTime(now.getTime()+30000);
    expect((await runtime()).statusCode).toBe(200);expect(current().publicRuntimePolicy!.renewal).toBeUndefined();
    vi.setSystemTime(now.getTime()+91000);expect((await runtime()).statusCode).toBe(403);
    expect(current().publicRuntime!.sequence).toBe(2);expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  });
  it("bounds a hanging authority without changing the currently valid grant",async()=>{
    await start();resolve.mockImplementation(()=>new Promise(()=>{}));vi.setSystemTime(now.getTime()+1000);
    expect((await runtime()).statusCode).toBe(200);expect(current().publicRuntimePolicy!.renewal).toBeUndefined();
  });
  it.each(["revoked","deleted","stopped","paused","uncertain","qa","cap","wrong_lease","wrong_sequence"])("never renews %s",async kind=>{
    await start();vi.setSystemTime(now.getTime()+1000);const next=event();
    if(kind==="revoked")await revokePublicInferenceEvidence(current().id,current().userId,"consent");
    if(kind==="deleted")current().accountDeletionRequestedAt=new Date().toISOString();
    if(kind==="stopped"){current().status="ended";current().publicRuntime!.stoppedAt=new Date().toISOString();}
    if(kind==="paused"){current().status="paused";current().publicRuntime!.phase="disconnected";}
    if(kind==="uncertain")current().publicRuntime!.uncertain=true;
    if(kind==="qa")current().publicRealtimeIssuance!.claims.qaOneShot={authorizationId:"qa-marker",hardDeadlineAt:Math.floor(Date.now()/1000)+10};
    if(kind==="cap")current().publicRuntimePolicy!.maxActiveSeconds=40;
    if(kind==="wrong_lease")next.leaseId="other";
    if(kind==="wrong_sequence")next.sequence++;
    const before=structuredClone(current());
    await createPublicRuntimeAdmissionRenewer(authority)(current().id,next).catch(()=>false);
    expect(current()).toEqual(before);expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("rechecks revocation after the asynchronous resolver",async()=>{
    await start();const source=resolve.getMockImplementation()!;
    resolve.mockImplementation(async(context,signal)=>{
      await revokePublicInferenceEvidence(current().id,current().userId,"consent");return source(context,signal);
    });
    vi.setSystemTime(now.getTime()+1000);expect((await runtime()).statusCode).toBe(503);
    expect(current().publicInferenceAdmission!.revokedAt).toBeDefined();expect(current().publicRuntimePolicy!.renewal).toBeUndefined();
  });
  it("rejects configuration drift and cannot overwrite it with an old snapshot",async()=>{
    await start();await savePublicModelConfiguration(body(1));vi.setSystemTime(now.getTime()+1000);
    expect((await runtime()).statusCode).toBe(409);expect(current().publicRuntimePolicy!.renewal).toBeUndefined();expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("cannot make a late promise extend an already expired lease",async()=>{
    await start();const source=resolve.getMockImplementation()!;
    resolve.mockImplementation(async(context,signal)=>{vi.setSystemTime(now.getTime()+91000);return source(context,signal);});
    vi.setSystemTime(now.getTime()+1000);expect((await runtime()).statusCode).toBe(403);
    expect(current().publicRuntimePolicy!.renewal).toBeUndefined();expect(current().publicRuntime!.sequence).toBe(1);
  });
  it("rejects malformed and unauthenticated requests before resolving authority",async()=>{
    await start();vi.setSystemTime(now.getTime()+1000);
    expect((await runtime({...event(),expiresAt:"2099-01-01"})).statusCode).toBe(400);
    expect((await runtime(event(),{})).statusCode).toBe(401);expect(resolve).toHaveBeenCalledTimes(1);
  });
});
