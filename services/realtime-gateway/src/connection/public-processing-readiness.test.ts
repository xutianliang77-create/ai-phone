import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { signPublicRuntimeLiveQualification } from "@translation/platform-security";
import { publicProcessingReadiness } from "./public-processing-readiness.js";

const key="a".repeat(64),now=new Date("2026-09-13T16:00:00.000Z"),base={publicDeploymentId:"public-test",publicRuntimeEnabled:true,
  publicCredentialAccessSecret:"p".repeat(32),internalApiSecret:"i".repeat(32),realtimeTokenSecret:"r".repeat(32),
  publicConfigurationHash:"b".repeat(64),publicModelPolicyRevision:"models-v1:test",publicActiveComponents:["asr","translation"]};
function signed(){const value={schemaVersion:1 as const,evidenceId:"live-test",deploymentId:base.publicDeploymentId,configurationHash:base.publicConfigurationHash,
  modelPolicyRevision:base.publicModelPolicyRevision,components:["asr","translation"] as const,providers:[{component:"asr" as const,providerId:"tencent",modelId:"16k_en"},{component:"translation" as const,providerId:"tencent",modelId:"service:tencent_tmt"}],
  qualifiedLanguagePairs:[{source:"en",target:"zh"}],observedAt:new Date(now.getTime()-1000).toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),sessionHash:"c".repeat(64),attemptHash:"d".repeat(64),finalizationHash:"e".repeat(64)};return {...value,signature:signPublicRuntimeLiveQualification(value,key)};}
describe("public processing readiness",()=>{
  it("remains not ready without independent live evidence",()=>expect(publicProcessingReadiness(base as any,now)).toMatchObject({status:"not_ready",issues:["public_runtime_live_qualification_not_configured"]}));
  it("admits only an isolated development bootstrap while withholding release readiness",()=>expect(publicProcessingReadiness({...base,publicQualificationBootstrap:true,nodeEnv:"development"} as any,now)).toMatchObject({status:"ready",sessionReady:true,releaseReady:false,evidence:"isolated_qualification_bootstrap",issues:["public_runtime_qualification_bootstrap_active"]}));
  it("rejects qualification bootstrap outside development",()=>expect(publicProcessingReadiness({...base,publicQualificationBootstrap:true,nodeEnv:"production"} as any,now)).toMatchObject({status:"not_ready",issues:["public_runtime_qualification_bootstrap_not_permitted"]}));
  it("reports ready only for an exact fresh signed observation",()=>{const dir=mkdtempSync(join(tmpdir(),"wujie-gateway-live-")),file=join(dir,"live.json");try{writeFileSync(file,JSON.stringify(signed()),{mode:0o600});const result=publicProcessingReadiness({...base,publicLiveQualificationFile:file,publicLiveQualificationKey:key} as any,now);expect(result).toMatchObject({status:"ready",sessionReady:true,releaseReady:true,evidence:"signed_live_qualification"});expect(result.services.map(service=>service.name)).toEqual(["asr","translation"]);}finally{rmSync(dir,{recursive:true,force:true});}});
  it("fails closed when the evidence expires",()=>{const dir=mkdtempSync(join(tmpdir(),"wujie-gateway-live-")),file=join(dir,"live.json");try{const value=signed();value.expiresAt=new Date(now.getTime()-1).toISOString();const {signature:_signature,...body}=value;value.signature=signPublicRuntimeLiveQualification(body,key);writeFileSync(file,JSON.stringify(value),{mode:0o600});expect(publicProcessingReadiness({...base,publicLiveQualificationFile:file,publicLiveQualificationKey:key} as any,now)).toMatchObject({status:"not_ready"});}finally{rmSync(dir,{recursive:true,force:true});}});
});
