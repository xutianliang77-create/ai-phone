import {afterEach,describe,expect,it} from "vitest";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {RealtimeTokenClaims} from "@translation/contracts";
import {signPublicRuntimeLiveQualification,type PublicRuntimeLiveQualification} from "@translation/platform-security";
import type {RealtimeEnv} from "../config/env.js";
import {publicProcessingReadiness} from "./public-processing-readiness.js";
import {publicSessionReadinessForVerifiedClaims} from "./public-session-readiness.js";
const now=new Date("2026-09-26T00:00:00Z"),key="a".repeat(64),silentHash="b".repeat(64),spokenHash="c".repeat(64);
let directory="";
afterEach(()=>{if(directory)rmSync(directory,{recursive:true,force:true});directory="";});
function claims(voice:boolean):RealtimeTokenClaims {
  const hash=voice?spokenHash:silentHash;
  return {userId:"owner",sessionId:"session",mode:"conversation",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:voice,
    planCode:"free",issuedAt:Math.floor(+now/1000)-5,expiresAt:Math.floor(+now/1000)+60,
    ...(voice?{voice:{mode:"preset" as const,presetId:"101001"}}:{}),
    processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:`models-v1:${hash}`,publicGrantRef:"grant",
      languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false},
      executionPlan:{asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},
        tts:voice?{execution:"public",scopeKey:"tts",reason:"online_selected"}:{execution:"disabled"}}},
    publicRuntime:{deploymentId:"public-test",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:hash}};
}
function evidence(voice:boolean,expired=false){
  const c=claims(voice),components:PublicRuntimeLiveQualification["components"]=voice?["asr","translation","tts"]:["asr","translation"];
  const value:Omit<PublicRuntimeLiveQualification,"signature">={schemaVersion:1,evidenceId:voice?"spoken":"silent",deploymentId:"public-test",
    configurationHash:c.publicRuntime!.configurationHash,modelPolicyRevision:c.processing!.modelPolicyRevision,components,
    providers:components.map(component=>({component,providerId:"tencent",modelId:`model-${component}`})),qualifiedLanguagePairs:[{source:"zh",target:"en"}],
    observedAt:new Date(+now-2000).toISOString(),expiresAt:new Date(+now+(expired?-1000:60000)).toISOString(),
    sessionHash:"d".repeat(64),attemptHash:"e".repeat(64),finalizationHash:"f".repeat(64)};
  return {...value,signature:signPublicRuntimeLiveQualification(value,key)};
}
function env(globalVoice:boolean):RealtimeEnv {
  directory=mkdtempSync(join(tmpdir(),"wujie-scoped-readiness-"));const file=join(directory,"live.json");
  writeFileSync(file,JSON.stringify({schemaVersion:2,qualifications:[evidence(false),evidence(true,true)]}),{mode:0o600});
  const c=claims(globalVoice);
  return {nodeEnv:"production",publicDeploymentId:"public-test",publicRuntimeEnabled:true,publicQualificationBootstrap:false,
    publicCredentialAccessSecret:"p".repeat(32),internalApiSecret:"i".repeat(32),realtimeTokenSecret:"r".repeat(32),
    publicConfigurationHash:c.publicRuntime!.configurationHash,publicModelPolicyRevision:c.processing!.modelPolicyRevision,
    publicActiveComponents:globalVoice?["asr","translation","tts"]:["asr","translation"],publicLiveQualificationFile:file,publicLiveQualificationKey:key} as RealtimeEnv;
}
describe("exact public session readiness without deployment-snapshot coupling",()=>{
  it("admits valid ASR+MT even when the monitor's spoken qualification has expired",()=>{
    const e=env(true),monitor=publicProcessingReadiness(e,now);expect(monitor.sessionReady).toBe(false);
    const result=publicSessionReadinessForVerifiedClaims(e,claims(false),monitor,now);
    expect(result).toMatchObject({sessionReady:true,evidence:"signed_live_qualification"});
    expect(result!.services.map(x=>x.name)).toEqual(["asr","translation"]);
  });
  it("never borrows silent readiness for an expired spoken snapshot",()=>{
    const e=env(false),monitor=publicProcessingReadiness(e,now);expect(monitor.sessionReady).toBe(true);
    expect(publicSessionReadinessForVerifiedClaims(e,claims(true),monitor,now)).toMatchObject({sessionReady:false,issues:["public_runtime_live_qualification_expired"]});
  });
  it("keeps runtime disablement and deployment binding fail-closed",()=>{
    const e=env(false),monitor=publicProcessingReadiness(e,now);
    expect(publicSessionReadinessForVerifiedClaims({...e,publicRuntimeEnabled:false},claims(false),monitor,now)).toMatchObject({sessionReady:false,issues:["public_runtime_disabled"]});
    const wrong=claims(false);wrong.publicRuntime!.deploymentId="other";
    expect(publicSessionReadinessForVerifiedClaims(e,wrong,monitor,now)).toMatchObject({sessionReady:false,issues:["public_runtime_token_binding_invalid"]});
  });
  it("preserves an unchecked/foreign monitor and the existing explicit test bypass",()=>{
    const e=env(false),initial={status:"not_ready" as const,sessionReady:false,releaseReady:false,checkedAt:"not_checked",issues:["not checked"],warnings:[],services:[]};
    expect(publicSessionReadinessForVerifiedClaims(e,claims(false),initial,now)).toBe(initial);
    expect(publicSessionReadinessForVerifiedClaims(e,claims(false),undefined,now)).toBeUndefined();
  });
});
