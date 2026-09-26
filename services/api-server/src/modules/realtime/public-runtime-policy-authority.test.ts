import {afterEach,describe,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {publicRealtimeAuthorityFromEnvironment,signPublicRuntimeAdmissionPolicy} from "./public-runtime-policy-authority.js";
import {signPublicRuntimeLiveQualification} from "@translation/platform-security";
import {emptyConfiguration} from "../models/public-model-config.js";
import type {PublicModelRuntimeSnapshot} from "../models/public-model-runtime-config.js";

vi.mock("../../infrastructure/storage/repository-runtime.js",()=>({
  getRepositoryRuntime:()=>({driver:"postgres"}),
}));

let dir="";const key="a".repeat(64),now=new Date(),expiresAt=new Date(now.getTime()+600000).toISOString();
const profiles=emptyConfiguration("public-test").components;
const configuration={schemaVersion:1,deploymentId:"public-test",configurationRevision:1,configurationHash:"b".repeat(64),modelPolicyRevision:"models-v1:test",
  executionPlan:{asr:{execution:"public",scopeKey:"asr:scope",reason:"online_selected"},translation:{execution:"public",scopeKey:"translation:scope",reason:"online_selected"},tts:{execution:"public",scopeKey:"tts:scope",reason:"online_selected"}},
  components:{asr:{...profiles.asr,vendor:"tencent",protocol:"tencent_asr_ws",modelId:"16k_zh",sampleRate:16000},translation:{...profiles.translation,vendor:"tencent",protocol:"tencent_tmt",modelId:"service:tencent_tmt"},tts:{...profiles.tts,vendor:"tencent",protocol:"tencent_tts_ws",modelId:"service:tencent_tts_ws"}}} satisfies PublicModelRuntimeSnapshot;
function policy(patch:any={}){const value:any={schemaVersion:1,policyId:"policy-test",deploymentId:"public-test",configurationHash:configuration.configurationHash,
  modelPolicyRevision:configuration.modelPolicyRevision,region:"cn",issuedAt:now.toISOString(),expiresAt,maxActiveSeconds:60,currency:"CNY",reservedMicros:0,
  qualifiedComponents:["asr","translation","tts"],providerAvailability:[{providerId:"tencent",state:"available"}],qualifiedLanguagePairs:[{source:"zh",target:"en"}],...patch};if(Object.hasOwn(patch,"maxActiveSeconds")&&patch.maxActiveSeconds===undefined)delete value.maxActiveSeconds;return {...value,signature:signPublicRuntimeAdmissionPolicy(value,key)};}
function environment(file:string,patch:any={}){return {PUBLIC_RUNTIME_ENABLED:"true",PUBLIC_RUNTIME_ADMISSION_POLICY_FILE:file,PUBLIC_RUNTIME_ADMISSION_POLICY_KEY:key,API_RESULT_SYNC_DEPLOYMENT_ID:"public-test",...patch};}
function context(patch:any={}){return {sessionId:"session",ownerId:"owner",deploymentId:"public-test",processingHash:"processing",configuration,
  languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},...patch};}
function liveQualification(patch:any={}){const value:any={schemaVersion:1,evidenceId:"live-test",deploymentId:"public-test",configurationHash:configuration.configurationHash,
  modelPolicyRevision:configuration.modelPolicyRevision,components:["asr","translation","tts"],providers:[{component:"asr",providerId:"tencent",modelId:"16k_zh"},{component:"translation",providerId:"tencent",modelId:"service:tencent_tmt"},{component:"tts",providerId:"tencent",modelId:"service:tencent_tts_ws"}],
  qualifiedLanguagePairs:[{source:"zh",target:"en"}],observedAt:new Date(now.getTime()-1000).toISOString(),expiresAt,sessionHash:"c".repeat(64),attemptHash:"d".repeat(64),finalizationHash:"e".repeat(64),...patch};return {...value,signature:signPublicRuntimeLiveQualification(value,key)};}
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir="";});
describe("signed public runtime admission policy",()=>{
  it('admits third-language return routes only when the complete source scope has real signed coverage',async()=>{
    dir=mkdtempSync(join(tmpdir(),'wujie-public-policy-'));const file=join(dir,'policy.json'),live=join(dir,'live.json');
    const pairs=[{source:'zh',target:'en'},{source:'en',target:'zh'},{source:'ja',target:'zh'},{source:'fr',target:'zh'}];
    const config:any={...configuration,components:{...configuration.components,asr:{...configuration.components.asr,vendor:'qwen',protocol:'qwen_asr_realtime',modelId:'qwen3-asr-flash-realtime'}}};
    const providers=[{component:'asr',providerId:'qwen',modelId:'qwen3-asr-flash-realtime'},
      {component:'translation',providerId:'tencent',modelId:'service:tencent_tmt'},{component:'tts',providerId:'tencent',modelId:'service:tencent_tts_ws'}];
    writeFileSync(file,JSON.stringify(policy({qualifiedLanguagePairs:pairs,automaticLanguage:true,automaticReverse:true,
      providerAvailability:[{providerId:'qwen',state:'available'},{providerId:'tencent',state:'available'}]})),{mode:0o600});
    writeFileSync(live,JSON.stringify(liveQualification({providers,qualifiedLanguagePairs:pairs,automaticLanguage:true,automaticReverse:true})),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file,{PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION:'true',PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE:live,PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY:key}))!;
    const languagePolicy={source:'auto',target:'en',autoReverse:true,pair:['zh','en'],sourceLanguages:['zh','en','ja','fr'],revision:2};
    await expect(authority.resolveVerifiedEvidence(context({configuration:config,languagePolicy}),new AbortController().signal)).resolves.toHaveProperty('records');
    // Adding an operator assertion alone cannot fake a Japanese/French live pass.
    writeFileSync(live,JSON.stringify(liveQualification({providers,qualifiedLanguagePairs:pairs.slice(0,2),automaticLanguage:true,automaticReverse:true})),{mode:0o600});
    await expect(authority.resolveVerifiedEvidence(context({configuration:config,languagePolicy}),new AbortController().signal)).rejects.toThrow('language_not_qualified');
  });
  it("is absent while the explicit public runtime is disabled",()=>expect(publicRealtimeAuthorityFromEnvironment({PUBLIC_RUNTIME_ENABLED:"false"})).toBeUndefined());
  it("admits exactly the available configured providers and emits only server evidence",async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy()),{mode:0o600});
    const result=await publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(),new AbortController().signal);
    expect(result.records.map(value=>value.kind)).toEqual(["provider_budget","model_qualification","model_qualification","model_qualification"]);
    expect(result.records.every(value=>value.kind!=="inference_consent")).toBe(true);expect(result.records.filter(value=>value.kind==="model_qualification").map(value=>(value as any).providerId)).toEqual(["tencent","tencent","tencent"]);
  });
  it("projects fixed pairs only for the exact qualified effective component scope",()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy()),{mode:0o600});
    const capability=publicRealtimeAuthorityFromEnvironment(environment(file))!.configurationCapability!;
    expect(capability(configuration)).toEqual({status:"qualified",qualifiedLanguagePairs:[{source:"zh",target:"en"}],automaticLanguage:false,automaticReverse:false});
    const withoutTts={...configuration,executionPlan:{...configuration.executionPlan,tts:{execution:"disabled" as const}}};
    expect(capability(withoutTts)).toEqual({status:"not_qualified",qualifiedLanguagePairs:[],automaticLanguage:false,automaticReverse:false});
  });
  it("does not offer a QA configuration once its one-shot start window is too short",()=>{
    dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");
    writeFileSync(file,JSON.stringify(policy()),{mode:0o600});
    const qa=(remainingMs:number)=>environment(file,{NODE_ENV:"development",PUBLIC_RUNTIME_QUALIFICATION_BOOTSTRAP:"true",
      PUBLIC_QA_ONE_SHOT_ENABLED:"true",PUBLIC_QA_ONE_SHOT_AUTHORIZATION_ID:"qa-authorization-1",
      PUBLIC_QA_ONE_SHOT_OWNER_ID:"owner",PUBLIC_QA_ONE_SHOT_DEPLOYMENT_ID:"public-test",
      PUBLIC_QA_ONE_SHOT_MAX_WALL_SECONDS:"40",PUBLIC_QA_ONE_SHOT_EXPIRES_AT:new Date(Date.now()+remainingMs).toISOString()});
    expect(publicRealtimeAuthorityFromEnvironment(qa(44_000))!.configurationCapability!(configuration).status).toBe("not_qualified");
    expect(publicRealtimeAuthorityFromEnvironment(qa(60_000))!.configurationCapability!(configuration).status).toBe("qualified");
  });
  it("does not offer signed directions rejected by the selected TMT or TTS wire",async()=>{
    dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");
    const pairs=[{source:"ar",target:"zh"},{source:"zh",target:"ja"},{source:"en",target:"zh"}];
    writeFileSync(file,JSON.stringify(policy({qualifiedLanguagePairs:pairs})),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file))!;
    expect(authority.configurationCapability!(configuration)).toMatchObject({
      status:"qualified",qualifiedLanguagePairs:[{source:"en",target:"zh"}],
    });
    for(const languagePolicy of [{source:"ar",target:"zh",autoReverse:false,revision:1},{source:"zh",target:"ja",autoReverse:false,revision:1}]){
      await expect(authority.resolveVerifiedEvidence(context({languagePolicy}),new AbortController().signal)).rejects.toThrow("language_not_qualified");
    }
  });
  it("does not offer reverse output when a spoken Google TTS combination cannot switch language",async()=>{
    dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");
    const config:any={...configuration,components:{...configuration.components,
      asr:{...configuration.components.asr,modelId:"16k_zh_en_2.0"},
      tts:{vendor:"google",protocol:"google_cloud_tts",modelId:"service:google_cloud_tts"}}};
    const spoken=policy({automaticLanguage:true,automaticReverse:true,
      qualifiedLanguagePairs:[{source:"zh",target:"en"},{source:"en",target:"zh"}],
      providerAvailability:[{providerId:"tencent",state:"available"},{providerId:"google",state:"available"}]});
    const silent={...config,configurationHash:"c".repeat(64),
      executionPlan:{...config.executionPlan,tts:{execution:"disabled" as const}}};
    const silentPolicy=policy({policyId:"policy-silent",configurationHash:silent.configurationHash,
      qualifiedComponents:["asr","translation"],automaticLanguage:true,automaticReverse:true,
      qualifiedLanguagePairs:[{source:"zh",target:"en"},{source:"en",target:"zh"}]});
    writeFileSync(file,JSON.stringify({schemaVersion:2,policies:[spoken,silentPolicy]}),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file))!;
    expect(authority.configurationCapability!(config)).toMatchObject({status:"qualified",automaticLanguage:true,automaticReverse:false});
    expect(authority.configurationCapability!(silent)).toMatchObject({status:"qualified",automaticLanguage:true,automaticReverse:true});
    await expect(authority.resolveVerifiedEvidence(context({configuration:config,
      languagePolicy:{source:"auto",target:"en",autoReverse:true,pair:["zh","en"],revision:2}}),new AbortController().signal))
      .rejects.toThrow("language_not_qualified");
  });
  it("admits inherited automatic Chinese/English routing only when adapter, policy and live evidence agree",async()=>{
    dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json"),live=join(dir,"live.json");
    const automaticConfiguration:any={...configuration,components:{...configuration.components,
      asr:{...configuration.components.asr,protocol:"tencent_asr_ws",modelId:"16k_zh_en_2.0"}}};
    const pairs=[{source:"zh",target:"en"},{source:"en",target:"zh"}];
    writeFileSync(file,JSON.stringify(policy({qualifiedLanguagePairs:pairs,automaticLanguage:true,automaticReverse:true})),{mode:0o600});
    writeFileSync(live,JSON.stringify(liveQualification({providers:[{component:"asr",providerId:"tencent",modelId:"16k_zh_en_2.0"},{component:"translation",providerId:"tencent",modelId:"service:tencent_tmt"},{component:"tts",providerId:"tencent",modelId:"service:tencent_tts_ws"}],qualifiedLanguagePairs:pairs,automaticLanguage:true,automaticReverse:true})),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file,{PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION:"true",PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE:live,PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY:key}))!;
    expect(authority.configurationCapability!(automaticConfiguration)).toMatchObject({status:"qualified",automaticLanguage:true,automaticReverse:true,qualifiedLanguagePairs:pairs});
    await expect(authority.resolveVerifiedEvidence(context({configuration:automaticConfiguration,
      languagePolicy:{source:"auto",target:"en",autoReverse:true,pair:["zh","en"],revision:2}}),new AbortController().signal)).resolves.toBeTruthy();
    writeFileSync(live,JSON.stringify(liveQualification({qualifiedLanguagePairs:pairs})),{mode:0o600});
    await expect(authority.resolveVerifiedEvidence(context({configuration:automaticConfiguration,
      languagePolicy:{source:"auto",target:"en",autoReverse:true,pair:["zh","en"],revision:2}}),new AbortController().signal)).rejects.toThrow();
  });
  it("selects separately signed policies for silent and spoken effective configurations",async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");
    const silent={...configuration,configurationHash:"c".repeat(64),executionPlan:{...configuration.executionPlan,tts:{execution:"disabled" as const}}};
    const spoken=policy(),silentPolicy=policy({policyId:"policy-silent",configurationHash:silent.configurationHash,qualifiedComponents:["asr","translation"]});
    writeFileSync(file,JSON.stringify({schemaVersion:2,policies:[spoken,silentPolicy]}),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file))!,capability=authority.configurationCapability!;
    expect(capability(configuration).status).toBe("qualified");expect(capability(silent).status).toBe("qualified");
    await expect(authority.resolveVerifiedEvidence(context({configuration:silent}),new AbortController().signal)).resolves.toMatchObject({records:expect.arrayContaining([expect.objectContaining({component:"asr"}),expect.objectContaining({component:"translation"})])});
  });
  it.each(["operator_expired","live_expired","live_revoked"])("keeps silent mode independent when spoken %s",async kind=>{
    dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json"),live=join(dir,"live.json");
    const silent={...configuration,configurationHash:"c".repeat(64),executionPlan:{...configuration.executionPlan,tts:{execution:"disabled" as const}}};
    const past={issuedAt:new Date(now.getTime()-20000).toISOString(),expiresAt:new Date(now.getTime()-10000).toISOString()};
    const spoken=policy(kind==="operator_expired"?past:{});
    const silentPolicy=policy({policyId:"silent",configurationHash:silent.configurationHash,qualifiedComponents:["asr","translation"]});
    const spokenLive=liveQualification(kind==="live_expired"?{observedAt:past.issuedAt,expiresAt:past.expiresAt}:kind==="live_revoked"?{revokedAt:now.toISOString()}:{});
    const silentLive=liveQualification({evidenceId:"silent",configurationHash:silent.configurationHash,components:["asr","translation"],providers:liveQualification().providers.filter(p=>p.component!=="tts")});
    writeFileSync(file,JSON.stringify({schemaVersion:2,policies:[spoken,silentPolicy]}),{mode:0o600});
    writeFileSync(live,JSON.stringify({schemaVersion:2,qualifications:[spokenLive,silentLive]}),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file,{PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION:"true",PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE:live,PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY:key}))!;
    expect(authority.configurationCapability!(silent).status).toBe("qualified");
    expect(authority.configurationCapability!(configuration).status).toBe("not_qualified");
    const resolved=await authority.resolveVerifiedEvidence(context({configuration:silent}),new AbortController().signal);
    expect(resolved.records.some(record=>record.kind==="model_qualification"&&record.component==="tts")).toBe(false);
  });
  it.each([
    {providerAvailability:[{providerId:"tencent",state:"unavailable"}]},
    {providerAvailability:[{providerId:"qwen",state:"available"}]},
    {providerAvailability:[{providerId:"tencent",state:"available"},{providerId:"qwen",state:"available"}]},
  ])("refuses an unavailable or mismatched global provider snapshot %j",async patch=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy(patch)),{mode:0o600});
    await expect(publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(),new AbortController().signal)).rejects.toThrow();
  });
  it.each([
    {context:{languagePolicy:{source:"zh",target:"ja",autoReverse:false,revision:2}}},
    {context:{languagePolicy:{source:"auto",target:"en",autoReverse:false,revision:2}}},
    {context:{languagePolicy:{source:"zh",target:"en",autoReverse:true,pair:["zh","en"],revision:2}}},
    {policy:{qualifiedLanguagePairs:[{source:"zh",target:"ja"}]}},
  ])("refuses language routing that the exact public configuration has not qualified %j",async input=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy(input.policy)),{mode:0o600});
    await expect(publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(input.context),new AbortController().signal)).rejects.toThrow();
  });
  it("allows an operator policy to omit a product session-duration cap",async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy({maxActiveSeconds:undefined})),{mode:0o600});
    const result=await publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(),new AbortController().signal);
    expect(result.records.find(value=>value.kind==="provider_budget")).not.toHaveProperty("maxActiveSeconds");
  });
  it("requires a current matching live qualification only when explicitly enabled",async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json"),live=join(dir,"live.json");writeFileSync(file,JSON.stringify(policy()),{mode:0o600});writeFileSync(live,JSON.stringify(liveQualification()),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file,{PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION:"true",PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE:live,PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY:key}));await expect(authority!.resolveVerifiedEvidence(context(),new AbortController().signal)).resolves.toBeTruthy();
    const expired=liveQualification({expiresAt:new Date(now.getTime()-1).toISOString()});writeFileSync(live,JSON.stringify(expired),{mode:0o600});await expect(authority!.resolveVerifiedEvidence(context(),new AbortController().signal)).rejects.toThrow("public_runtime_live_qualification_expired");
  });
  it("seals the earlier live-proof expiry instead of inheriting a longer operator policy",async()=>{
    dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json"),live=join(dir,"live.json");
    const earlier=new Date(now.getTime()+120000).toISOString();
    writeFileSync(file,JSON.stringify(policy()),{mode:0o600});writeFileSync(live,JSON.stringify(liveQualification({expiresAt:earlier})),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file,{PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION:"true",PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE:live,PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY:key}))!;
    const result=await authority.resolveVerifiedEvidence(context(),new AbortController().signal);
    expect(result.records.filter(record=>record.kind==="model_qualification").map(record=>record.expiresAt)).toEqual([earlier,earlier,earlier]);
    expect(result.records.find(record=>record.kind==="provider_budget")!.expiresAt).toBe(expiresAt);
  });
  it("permits a signed-policy qualification bootstrap only in development",async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy()),{mode:0o600});
    const authority=publicRealtimeAuthorityFromEnvironment(environment(file,{NODE_ENV:"development",PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION:"true",PUBLIC_RUNTIME_QUALIFICATION_BOOTSTRAP:"true"}));
    await expect(authority!.resolveVerifiedEvidence(context(),new AbortController().signal)).resolves.toBeTruthy();
    expect(authority!.configurationCapability!(configuration).status).toBe("qualified");
    expect(()=>publicRealtimeAuthorityFromEnvironment(environment(file,{NODE_ENV:"production",PUBLIC_RUNTIME_QUALIFICATION_BOOTSTRAP:"true"}))).toThrow("public_runtime_qualification_bootstrap_not_permitted");
  });
  it.each([{configurationHash:"c".repeat(64)},{qualifiedComponents:["asr","translation"]},{providerAvailability:[]},{qualifiedLanguagePairs:[]},{signature:"0".repeat(64)}])("rejects mismatched or unsigned policy %j",async patch=>{dir=mkdtempSync(join(tmpdir(),"wujie-public-policy-"));const file=join(dir,"policy.json");writeFileSync(file,JSON.stringify(policy(patch)),{mode:0o600});
    await expect(publicRealtimeAuthorityFromEnvironment(environment(file))!.resolveVerifiedEvidence(context(),new AbortController().signal)).rejects.toThrow();
  });
});
