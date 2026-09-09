import {describe,it,expect} from "vitest";
import type {RealtimeTokenClaims} from "./session.js";
import {publicRuntimeTokenBinding} from "./public-runtime-token.js";
const claims=():RealtimeTokenClaims=>({sessionId:"s",userId:"u",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,
  planCode:"free",maxDurationSeconds:60,issuedAt:1,expiresAt:301,
  processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",publicGrantRef:"grant",syncPermission:{allowed:false},
    languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},executionPlan:{asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},
      translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}}},
  publicRuntime:{deploymentId:"deployment",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationHash:"a".repeat(64),configurationRevision:1}});
describe("signed runtime binding structural projection",()=>{
  it.each([16000,24000] as const)("retains exact %i server rate without selecting a model",rate=>{
    const c=claims();c.publicRuntime!.sampleRate=rate;expect(publicRuntimeTokenBinding(c,"deployment")).toEqual(c.publicRuntime);
    const copy=publicRuntimeTokenBinding(c,"deployment")!;copy.captureId="changed";expect(c.publicRuntime!.captureId).toBe("capture");
  });
  it.each([{}, {sampleRate:48000},{configurationRevision:0},{configurationHash:"not-a-hash"},{captureId:""},{deploymentId:"other"},{apiKey:"forged"}])("rejects malformed binding %j",patch=>{
    const c=claims();c.publicRuntime=Object.keys(patch).length?{...c.publicRuntime!,...patch} as any:{} as any;
    expect(publicRuntimeTokenBinding(c,"deployment")).toBeNull();
  });
  it.each(["legacy","grant","language","voice","placement","sync","extra"])("rejects %s authority mismatch",kind=>{
    const c=claims();if(kind==="legacy")delete c.processing;else if(kind==="grant")delete c.processing!.publicGrantRef;
    else if(kind==="language")c.sourceLanguage="fr";else if(kind==="voice")c.voiceOutput=true;
    else if(kind==="placement")c.processing!.executionPlan.asr={execution:"device",scopeKey:"device"};
    else if(kind==="sync")(c.processing as any).syncPermission={allowed:true};else (c.processing as any).allowAll=true;
    expect(publicRuntimeTokenBinding(c,"deployment")).toBeNull();
  });
});
