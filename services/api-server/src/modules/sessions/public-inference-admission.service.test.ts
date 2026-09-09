import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import * as storage from "../../infrastructure/storage/json-store.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission,revokePublicInferenceEvidence} from "./public-inference-admission.service.js";
import {issuePublicRuntimeLease,publicProcessingHash,verifiedPublicAdmission} from "./public-runtime-admission.js";
import {observePublicRuntime,publicRecoveryStatus} from "./public-session-runtime.service.js";
import type {PublicInferenceEvidence} from "./public-inference-evidence.js";
import type {SessionRecord} from "./session-record.js";
const epoch=Date.parse("2026-09-08T00:00:00Z"),now=new Date(epoch),until=new Date(epoch+600000).toISOString();
const refs={consentReceiptId:"consent",budgetReservationId:"budget",qualificationReceiptIds:{asr:"asr",translation:"mt"}};
const current=()=>storage.getStoreSnapshot().sessions[0];
const snapshot=()=>structuredClone(storage.getStoreSnapshot());
const write=()=>writePublicInferenceAdmission("evidence-session","owner",refs,now);
const register=(e:PublicInferenceEvidence)=>recordPublicInferenceEvidence("evidence-session","owner",e,now);
function receipts():PublicInferenceEvidence[]{
  const common={sessionId:"evidence-session",ownerId:"owner",deploymentId:"public-test",processingHash:publicProcessingHash(current()),
    issuedAt:now.toISOString(),expiresAt:until,region:"test-region",providerPolicyRevision:"test-policy",sourceReceiptId:"synthetic-source"};
  return [{...common,id:"consent",kind:"inference_consent",version:"public-inference-v1",components:["asr","translation"]},
    {...common,id:"budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,maxActiveSeconds:120,sampleRate:16000},
    {...common,id:"asr",kind:"model_qualification",state:"qualified",component:"asr",scopeKey:"asr-zh",providerId:"synthetic-provider",modelId:"synthetic-asr"},
    {...common,id:"mt",kind:"model_qualification",state:"qualified",component:"translation",scopeKey:"mt-zh-en",providerId:"synthetic-provider",modelId:"synthetic-mt"}];
}
beforeEach(async()=>{
  vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");const s=storage.getStoreSnapshot();
  s.sessions=[{id:"evidence-session",userId:"owner",mode:"conversation",status:"created",consumedSeconds:0,createdAt:now.toISOString(),segments:[],
    processingDeploymentId:"public-test",processingAuthorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"p",
      syncPermission:{allowed:false},languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},executionPlan:{
        asr:{execution:"public",scopeKey:"asr-zh",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt-zh-en",reason:"online_selected"},tts:{execution:"disabled"}}}} satisfies SessionRecord];
  s.billingLedger=[];s.usageHolds=[];for(const r of receipts())await register(r);
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("dedicated stored inference evidence and admission writer",()=>{
  it("resolves exact records and atomically writes one grant, then issues the original lease",async()=>{
    const evidence=snapshot();const grants=await Promise.all(Array.from({length:5},()=>write()));
    expect(grants.every(g=>g.grantRef===grants[0].grantRef)).toBe(true);expect(grants[0].evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(current().processingAuthorization!.publicGrantRef).toBe(grants[0].grantRef);
    expect(verifiedPublicAdmission(current(),"owner",now)).toEqual(grants[0]);
    const p=await issuePublicRuntimeLease(current().id,"owner",now);expect(p.maxActiveSeconds).toBe(120);
    expect(snapshot().billingLedger).toEqual(evidence.billingLedger);expect(snapshot().usageHolds).toEqual(evidence.usageHolds);
  });
  it.each(["consent","budget","asr","mt"])("rejects a missing referenced %s record",async id=>{
    current().publicInferenceEvidence=current().publicInferenceEvidence!.filter(e=>e.id!==id);const before=snapshot();
    await expect(write()).rejects.toThrow("not_found");expect(snapshot()).toEqual(before);
  });
  it.each(["ownerId","sessionId","deploymentId","processingHash"])("rejects cross-bound evidence %s before storing it",async key=>{
    const e={...receipts()[0],[key]:"other"},before=snapshot();await expect(register(e)).rejects.toThrow("invalid");expect(snapshot()).toEqual(before);
  });
  it.each(["region","providerPolicyRevision"])("rejects incompatible %s across consent and qualification",async key=>{
    (current().publicInferenceEvidence![2] as unknown as Record<string,unknown>)[key]="other";
    await expect(write()).rejects.toThrow("scope_mismatch");
  });
  it("requires enabled component consent and does not turn text-sync consent into inference permission",async()=>{
    const e=current().publicInferenceEvidence![0];if(e.kind==="inference_consent")e.components=["translation"];
    current().processingAuthorization!.syncPermission={allowed:true,scopeId:"old-text-sync"};
    await expect(write()).rejects.toThrow("scope_mismatch");
  });
  it("rejects released/unknown budget and wrong model capability",async()=>{
    const e=current().publicInferenceEvidence![1] as unknown as Record<string,unknown>;e.state="released";
    await expect(write()).rejects.toThrow("invalid");e.state="reserved";e.reservedMicros=null;await expect(write()).rejects.toThrow("invalid");
    e.reservedMicros=100;const q=current().publicInferenceEvidence![2];if(q.kind==="model_qualification")q.scopeKey="asr-fr";
    await expect(write()).rejects.toThrow("invalid");
  });
  it("retries identical receipts without mutation and never overwrites changed contents",async()=>{
    const e=receipts()[0],before=snapshot();await register(e);expect(snapshot()).toEqual(before);
    await expect(register({...e,sourceReceiptId:"changed"})).rejects.toThrow("conflict");expect(snapshot()).toEqual(before);
  });
  it("revokes source evidence monotonically and blocks an already-issued lease",async()=>{
    await write();const p=await issuePublicRuntimeLease(current().id,"owner",now);
    const event={leaseId:p.leaseId,captureId:p.captureId,languagePolicyKey:p.languagePolicyKey,sequence:1,phase:"active",finalRevision:0,lastAcceptedSample:0};
    await observePublicRuntime(current().id,event,now);
    const revoked=await revokePublicInferenceEvidence(current().id,"owner","budget",new Date(epoch+1000));
    const before=snapshot();expect(await revokePublicInferenceEvidence(current().id,"owner","budget",new Date(epoch+2000))).toBe(revoked);expect(snapshot()).toEqual(before);
    await expect(observePublicRuntime(current().id,event,new Date(epoch+2000))).rejects.toThrow("admission_required");
    expect((await publicRecoveryStatus(current().id,"owner",new Date(epoch+2000))).canResume).toBe(false);
  });
  it("does not resurrect revoked evidence or grant by replaying registration",async()=>{
    const e=receipts()[0];await revokePublicInferenceEvidence(current().id,"owner",e.id,now);
    await expect(register(e)).rejects.toThrow("conflict");await expect(write()).rejects.toThrow("invalid");
  });
  it("detects evidence tampering after grant construction",async()=>{
    await write();current().publicInferenceEvidence![2].sourceReceiptId="changed";
    await expect(issuePublicRuntimeLease(current().id,"owner",now)).rejects.toThrow("evidence_conflict");
  });
  it("rejects duplicates and untrusted extra fields",async()=>{
    await expect(register({...receipts()[0],providerUsage:{cost:0}} as never)).rejects.toThrow("invalid");
    expect(()=>writePublicInferenceAdmission(current().id,"owner",{...refs,billableSeconds:0} as never,now)).toThrow("invalid");
    current().publicInferenceEvidence!.push(receipts()[0]);await expect(write()).rejects.toThrow("not_found");
  });
  it("rolls back grant and processing reference together on persistence failure",async()=>{
    const before=snapshot();vi.spyOn(storage,"persistStoreSnapshot").mockImplementationOnce(()=>{throw Error("disk failure");});
    await expect(write()).rejects.toThrow("disk failure");expect(snapshot()).toEqual(before);
  });
});
