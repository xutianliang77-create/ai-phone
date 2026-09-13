import {afterEach,describe,expect,it} from "vitest";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {publicRealtimeAuthorityFromEnvironment,signPublicRuntimeAdmissionPolicy} from "./public-runtime-policy-authority.js";

let dir="";const key="a".repeat(64),now=new Date(),expiresAt=new Date(now.getTime()+600000).toISOString();
const configuration={deploymentId:"public-test",configurationRevision:1,configurationHash:"b".repeat(64),modelPolicyRevision:"models-v1:test",
  executionPlan:{asr:{execution:"public",scopeKey:"asr:scope",reason:"online_selected"},translation:{execution:"public",scopeKey:"translation:scope",reason:"online_selected"},tts:{execution:"public",scopeKey:"tts:scope",reason:"online_selected"}},
  components:{asr:{vendor:"tencent",modelId:"16k_zh",sampleRate:16000},translation:{vendor:"tencent",modelId:"service:tencent_tmt"},tts:{vendor:"tencent",modelId:"service:tencent_tts_ws"}}};
function policy(patch:any={}){const value:any={schemaVersion:1,policyId:"policy-test",deploymentId:"public-test",configurationHash:configuration.configurationHash,
  modelPolicyRevision:configuration.modelPolicyRevision,region:"cn",issuedAt:now.toISOString(),expiresAt,maxActiveSeconds:60,currency:"CNY",reservedMicros:0,
  qualifiedComponents:["asr","translation","tts"],...patch};return {...value,signature:signPublicRuntimeAdmissionPolicy(value,key)};}
function environment(file:string,patch:any={}){return {PUBLIC_RUNTIME_ENABLED:"true",PUBLIC_RUNTIME_ADMISSION_POLICY_FILE:file,PUBLIC_RUNTIME_ADMISSION_POLICY_KEY:key,API_RESULT_SYNC_DEPLOYMENT_ID:"public-test",...patch};}
function context(){return {sessionId:"session",ownerId:"owner",deploymentId:"public-test",processingHash:"processing",configuration};}
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir="";});
describe("signed public runtime admission policy",()=>{
  it("is absent while the explicit public runtime is disabled",()=>expect(publicRealtimeAuthorityFromEnvironment({PUBLIC_RUNTIME_ENABLED:"false"})).toBeUndefined());
  it("emits only budget and configuration-bound qualification records",async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy()),{mode:0o600});
    const result=await publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(),new AbortController().signal);
    expect(result.records.map(value=>value.kind)).toEqual(["provider_budget","model_qualification","model_qualification","model_qualification"]);
    expect(result.records.every(value=>value.kind!=="inference_consent")).toBe(true);expect(result.records.filter(value=>value.kind==="model_qualification").map(value=>(value as any).providerId)).toEqual(["tencent","tencent","tencent"]);
  });
  it.each([{configurationHash:"c".repeat(64)},{qualifiedComponents:["asr","translation"]},{signature:"0".repeat(64)}])("rejects mismatched or unsigned policy %j",async patch=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy(patch)),{mode:0o600});
    await expect(publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(),new AbortController().signal)).rejects.toThrow();
  });
});
