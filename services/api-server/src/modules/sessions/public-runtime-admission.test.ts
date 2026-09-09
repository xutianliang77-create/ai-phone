import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import * as storage from "../../infrastructure/storage/json-store.js";
import {issuePublicRuntimeLease,publicProcessingHash,type PublicInferenceAdmission} from "./public-runtime-admission.js";
import {observePublicRuntime,publicRecoveryStatus} from "./public-session-runtime.service.js";
import type {SessionRecord} from "./session-record.js";
import {resolveInferenceEvidence} from "./public-inference-evidence.js";
const start=Date.parse("2026-09-08T00:00:00Z"),now=()=>new Date(start);
const at=(seconds:number)=>new Date(start+seconds*1000).toISOString();
const current=()=>storage.getStoreSnapshot().sessions[0];
const snapshot=()=>structuredClone(storage.getStoreSnapshot());
beforeEach(()=>{vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");
  const s=storage.getStoreSnapshot();s.sessions=[session()];s.billingLedger=[];s.usageHolds=[];});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
function admission(s:SessionRecord):PublicInferenceAdmission{
  const common={sessionId:s.id,ownerId:s.userId,deploymentId:"public-test",processingHash:publicProcessingHash(s),
    region:"test-region",providerPolicyRevision:"test-provider-policy",sourceReceiptId:"test-source",issuedAt:at(-1)};
  s.publicInferenceEvidence=[{...common,id:"consent",kind:"inference_consent",version:"public-inference-v1",components:["asr","translation","tts"],expiresAt:at(600)},
    {...common,id:"budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,maxActiveSeconds:120,sampleRate:16000,expiresAt:at(300)},
    ...(["asr","translation"] as const).map(component=>({...common,id:component==="asr"?"asr-qualified":"mt-qualified",
      kind:"model_qualification" as const,state:"qualified" as const,component,scopeKey:s.processingAuthorization!.executionPlan[component].scopeKey,
      providerId:"test-provider",modelId:`test-${component}`,expiresAt:at(180)}))];
  const a:PublicInferenceAdmission={grantRef:"grant",ownerId:"owner",deploymentId:"public-test",
  processingHash:publicProcessingHash(s),consentReceiptId:"consent",budgetReservationId:"budget",
  qualificationReceiptIds:{asr:"asr-qualified",translation:"mt-qualified"},issuedAt:at(-1),expiresAt:at(600),
  budgetExpiresAt:at(300),qualificationExpiresAt:at(180),maxActiveSeconds:120,sampleRate:16000};
  if(s.processingAuthorization!.executionPlan.tts.execution==="disabled")a.evidenceHash=resolveInferenceEvidence(s,a,now()).evidenceHash;
  return a;
}
function session():SessionRecord{
  const s:SessionRecord={id:"lease-session",userId:"owner",mode:"conversation",status:"created",consumedSeconds:0,createdAt:at(-1),segments:[],
    processingDeploymentId:"public-test",processingAuthorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"p",
      publicGrantRef:"grant",syncPermission:{allowed:false},languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},
      executionPlan:{asr:{execution:"public",scopeKey:"asr-zh",reason:"online_selected"},
        translation:{execution:"public",scopeKey:"mt-zh-en",reason:"online_selected"},tts:{execution:"disabled"}}}};
  s.publicInferenceAdmission=admission(s);return s;
}
const issue=(owner="owner",date=now())=>issuePublicRuntimeLease("lease-session",owner,date);
describe("server-domain public lease issuance",()=>{
  it("issues generated identities with shortest evidence deadline and does not renew on concurrent retry",async()=>{
    const before=snapshot();const policies=await Promise.all(Array.from({length:8},()=>issue()));
    expect(policies.every(p=>JSON.stringify(p)===JSON.stringify(policies[0]))).toBe(true);
    expect(policies[0]).toMatchObject({expiresAt:at(180),maxActiveSeconds:120,sampleRate:16000});
    expect(policies[0].leaseId).not.toBe(policies[0].captureId);expect(policies[0].admissionHash).toMatch(/^[a-f0-9]{64}$/);
    const saved=snapshot();expect(await issue("owner",new Date(start+60000))).toEqual(policies[0]);expect(snapshot()).toEqual(saved);
    expect(saved.billingLedger).toEqual(before.billingLedger);expect(saved.usageHolds).toEqual(before.usageHolds);
  });
  it.each(["ownerId","deploymentId","processingHash","consentReceiptId","budgetReservationId","grantRef"])(
    "rejects invalid admission field %s without writes",async key=>{
      (current().publicInferenceAdmission as unknown as Record<string,unknown>)[key]="";const before=snapshot();
      await expect(issue()).rejects.toThrow();expect(snapshot()).toEqual(before);
    });
  it.each(["expiresAt","budgetExpiresAt","qualificationExpiresAt"])("rejects expired %s",async key=>{
    (current().publicInferenceAdmission as unknown as Record<string,unknown>)[key]=at(0);const before=snapshot();
    await expect(issue()).rejects.toThrow("expired");expect(snapshot()).toEqual(before);
  });
  it("does not substitute text-sync or old generic processing permission for inference admission",async()=>{
    delete current().publicInferenceAdmission;
    current().processingAuthorization!.syncPermission={allowed:true,scopeId:"text-only"};
    const before=snapshot();await expect(issue()).rejects.toThrow("admission_required");expect(snapshot()).toEqual(before);
  });
  it("requires qualification only for enabled components and binds the exact language/voice policy",async()=>{
    current().processingAuthorization!.executionPlan.tts={execution:"public",scopeKey:"tts-en",reason:"online_selected"};
    current().publicInferenceAdmission=admission(current());
    await expect(issue()).rejects.toThrow("qualification_required");
    current().publicInferenceAdmission!.qualificationReceiptIds.tts="tts-qualified";
    const asr=current().publicInferenceEvidence!.find(e=>e.kind==="model_qualification")!;
    current().publicInferenceEvidence!.push({...asr,kind:"model_qualification",state:"qualified",id:"tts-qualified",component:"tts",scopeKey:"tts-en",providerId:"test",modelId:"tts"});
    current().publicInferenceAdmission!.evidenceHash=resolveInferenceEvidence(current(),current().publicInferenceAdmission!,now()).evidenceHash;await issue();
    current().processingAuthorization!.languagePolicy.target="fr";
    await expect(issue()).rejects.toThrow("admission_required");
  });
  it("rejects owner mismatch, terminal state and missing session",async()=>{
    await expect(issue("other")).rejects.toThrow("forbidden");current().status="ended";
    await expect(issue()).rejects.toThrow("terminal");current().status="failed";
    await expect(issue()).rejects.toThrow("terminal");storage.getStoreSnapshot().sessions=[];
    await expect(issue()).rejects.toThrow("session_not_found");
  });
  it("does not replace an existing lease after evidence changes",async()=>{
    const p=await issue();current().publicInferenceAdmission!.budgetReservationId="replacement-budget";
    await expect(issue()).rejects.toThrow();expect(current().publicRuntimePolicy).toEqual(p);
  });
  it("rolls back an unpersisted lease instead of reporting an issued identity",async()=>{
    const before=snapshot();vi.spyOn(storage,"persistStoreSnapshot").mockImplementationOnce(()=>{throw Error("disk failure");});
    await expect(issue()).rejects.toThrow("disk failure");expect(snapshot()).toEqual(before);
  });
  it("revocation blocks new and replayed active events; stop remains uncertain for reconciliation",async()=>{
    const p=await issue();const event={leaseId:p.leaseId,captureId:p.captureId,languagePolicyKey:p.languagePolicyKey,
      sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0};
    await observePublicRuntime("lease-session",event,now());current().publicInferenceAdmission!.revokedAt=at(1);
    const before=snapshot();await expect(observePublicRuntime("lease-session",event,new Date(start+2000))).rejects.toThrow("admission_required");
    expect(snapshot()).toEqual(before);expect((await publicRecoveryStatus("lease-session","owner",new Date(start+2000))).canResume).toBe(false);
    const stopped=await observePublicRuntime("lease-session",{...event,sequence:2,phase:"stopped"},new Date(start+2000));
    expect(stopped.uncertain).toBe(true);expect(storage.getStoreSnapshot().billingLedger).toEqual([]);
  });
});
