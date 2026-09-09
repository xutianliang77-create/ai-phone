import {beforeEach,afterEach,expect,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as storage from "../../infrastructure/storage/json-store.js";
import {emptyConfiguration,publicModelCatalog} from "../models/public-model-config.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {bindPublicModelConfiguration} from "./public-model-configuration.service.js";
import {inferenceProcessingHash,type PublicInferenceEvidence} from "./public-inference-evidence.js";
import type {SessionRecord} from "./session-record.js";
export let dir:string;
export const now=new Date("2026-09-08T00:00:00Z");
export const secret="SYNTHETIC_RUNTIME_SECRET_NOT_REAL";
export const current=()=>storage.getStoreSnapshot().sessions[0];
export function body(revision=0){
  const config=emptyConfiguration("runtime-test");
  for(const component of ["asr","translation","tts"] as const){
    const p=publicModelCatalog.protocols.find(p=>p.component===component&&p.vendor==="qwen")!;
    Object.assign(config.components[component],{enabled:true,endpoint:`${p.scheme}//synthetic.invalid/api`,modelId:`manual-${component}`,voice:"manual-voice"});
  }
  return {expectedRevision:revision,components:config.components,credentials:{asr:{apiKey:secret},translation:{apiKey:secret},tts:{apiKey:secret}}};
}
export function session(voiceOutput=false){
  const s=capturePublicModelRuntimeConfiguration(voiceOutput);
  const record:SessionRecord={id:"configured-session",userId:"owner",mode:"conversation",status:"created",consumedSeconds:0,
    createdAt:now.toISOString(),segments:[],processingDeploymentId:"runtime-test",processingAuthorization:{
      contractVersion:1,processingMode:"online",modelPolicyRevision:s.modelPolicyRevision,executionPlan:s.executionPlan,
      languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false}}};
  storage.getStoreSnapshot().sessions=[record];return s;
}
export const bind=(revision=1)=>bindPublicModelConfiguration("configured-session","owner",revision);
export function evidence():PublicInferenceEvidence[]{
  const s=current(),config=s.publicModelConfiguration!;
  const common={sessionId:s.id,ownerId:s.userId,deploymentId:"runtime-test",processingHash:inferenceProcessingHash(s),
    issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString(),region:"synthetic-region",
    providerPolicyRevision:config.modelPolicyRevision,sourceReceiptId:"synthetic-only"};
  const components: Array<"asr"|"translation"|"tts">=config.executionPlan.tts.execution==="public"?["asr","translation","tts"]:["asr","translation"];
  return [{...common,id:"consent",kind:"inference_consent",version:"public-inference-v1",components},
    {...common,id:"budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,maxActiveSeconds:60,sampleRate:config.components.asr!.sampleRate},
    ...components.map(component=>({...common,id:component,kind:"model_qualification" as const,state:"qualified" as const,
      component,scopeKey:(config.executionPlan[component] as {scopeKey:string}).scopeKey,providerId:config.components[component]!.vendor,modelId:config.components[component]!.modelId}))];
}

export function installConfigurationFixture(){
beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),"wujie-runtime-config-test-"));
  vi.stubEnv("PUBLIC_MODEL_CONFIG_FILE",join(dir,"public.enc"));vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","ab".repeat(32));
  vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","runtime-test");vi.stubEnv("PRIVATE_MODEL_CONFIG_FILE",join(dir,"unread-private.enc"));
  vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Real calls forbidden"));
  await savePublicModelConfiguration(body());session();
});
afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
}
