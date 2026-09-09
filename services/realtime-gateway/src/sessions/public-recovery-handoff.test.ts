import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import type {RealtimeTokenClaims,PublicAdmissionReceipt} from "@translation/contracts";
import {publicRuntimeTokenBinding} from "@translation/contracts";
import {attachSession,createSession,deleteSession,getSession,confirmSessionConnection,recordPublicDisconnectCheckpoint} from "./session-manager.js";
import {RealtimeConnectionCleanup} from "../connection/realtime-connection-cleanup.js";
import {DisconnectFinalizerRegistry} from "./disconnect-finalizer-registry.js";
const epoch=1000000;
const claims=():RealtimeTokenClaims=>({userId:"owner",sessionId:"public-handoff",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,planCode:"free",issuedAt:1000,expiresAt:1300,maxDurationSeconds:60,
  processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",publicGrantRef:"grant",syncPermission:{allowed:false},languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},
    executionPlan:{asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}}},
  publicRuntime:{deploymentId:"public",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:"a".repeat(64)}});
function receipt():PublicAdmissionReceipt {
  const c=claims();return {...publicRuntimeTokenBinding(c,"public")!,contractVersion:1,requestId:"nonce",sessionId:c.sessionId,ownerId:c.userId,modelPolicyRevision:"policy",grantRef:"grant",purpose:"recovery",
    allowed:true,checkedAt:new Date().toISOString(),expiresAt:new Date(epoch+300000).toISOString(),maxActiveSeconds:60,status:"paused",
    recovery:{runtimeSequence:3,lastAcceptedSample:16000,finalRevision:2,activeMs:1000,recoveryUntil:new Date(epoch+60000).toISOString()}};
}
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(epoch);deleteSession("public-handoff");});
afterEach(()=>{deleteSession("public-handoff");vi.useRealTimers();});
describe("same-process original session generation handoff",()=>{
  it("keeps the same aggregate and permits exactly one expected-generation attachment without activating audio",async()=>{
    const c=claims(),s=createSession(c),r=receipt();expect(recordPublicDisconnectCheckpoint(s.id,1,r)).toBe(true);
    expect(s.status).toBe("connecting");expect(attachSession(c)).toBeNull();
    const next=attachSession(c,{expectedGeneration:1,receipt:{...r,requestId:"fresh-nonce"}});
    expect(next).toMatchObject({session:s,generation:2,resumed:true});expect(s.status).toBe("connecting");
    expect(attachSession(c,{expectedGeneration:1,receipt:r})).toBeNull();expect(s.connectionGeneration).toBe(2);
    expect(confirmSessionConnection(s.id,1)).toBe(false);expect(confirmSessionConnection(s.id,2)).toBe(true);expect(s.status).toBe("paused");
  });
  it.each(["generation","sample","revision","sequence","activeMs","owner","claimLanguage","expired","stopped"])("rejects %s mismatch without altering the retained aggregate",kind=>{
    const c=claims(),s=createSession(c),r=receipt();expect(recordPublicDisconnectCheckpoint(s.id,1,r)).toBe(true);
    const next=structuredClone(r),candidate=structuredClone(c);let generation=1;
    if(kind==="generation")generation=0;if(kind==="sample")next.recovery!.lastAcceptedSample++;if(kind==="revision")next.recovery!.finalRevision++;
    if(kind==="sequence")next.recovery!.runtimeSequence++;if(kind==="activeMs")next.recovery!.activeMs++;
    if(kind==="owner")next.ownerId="other";if(kind==="claimLanguage")candidate.sourceLanguage="fr";
    if(kind==="expired")vi.setSystemTime(epoch+60000);if(kind==="stopped")s.status="ending";
    const before=structuredClone(s);expect(attachSession(candidate,{expectedGeneration:generation,receipt:next})).toBeNull();expect(s).toEqual(before);
  });
  it("never creates a replacement aggregate on a recovery call or accepts private recovery",()=>{
    expect(attachSession(claims(),{expectedGeneration:1,receipt:receipt()})).toBeNull();expect(getSession("public-handoff")).toBeNull();
    const c=claims();delete c.publicRuntime;delete c.processing;createSession(c);
    expect(recordPublicDisconnectCheckpoint(c.sessionId,1,receipt())).toBe(false);
  });
  it("requires exact current receipt and does not extend the original disconnect deadline on repeat",()=>{
    const s=createSession(claims()),r=receipt();expect(recordPublicDisconnectCheckpoint(s.id,2,r)).toBe(false);
    expect(recordPublicDisconnectCheckpoint(s.id,1,{...r,ownerId:"other"})).toBe(false);
    expect(recordPublicDisconnectCheckpoint(s.id,1,r)).toBe(true);const before=structuredClone(s);
    expect(recordPublicDisconnectCheckpoint(s.id,1,{...r,requestId:"repeat"})).toBe(true);expect(s).toEqual(before);
  });
});
describe("public disconnect cleanup checkpoint ordering",()=>{
  it("drains, confirms disconnected, then retains the existing immediate-finalization policy",async()=>{
    const s=createSession(claims()),order:string[]=[],registry=new DisconnectFinalizerRegistry(30000,()=>{});
    const cleanup=new RealtimeConnectionCleanup({session:s,generation:1,publicImmediateFinalization:true,
      finalizer:{flush:async()=>{order.push("flush");return {} as any;},finalize:async()=>{expect(s.publicDisconnect?.receipt.recovery?.lastAcceptedSample).toBe(16000);order.push("finalize");}},
      checkpointDisconnect:async()=>{order.push("checkpoint");return receipt();},provider:{closeSession:async()=>{order.push("close");}},sessionSync:{drain:async()=>{}},disconnectFinalizers:registry,closeClient:()=>{},onError:()=>{throw Error("unexpected");}});
    await Promise.all([cleanup.run("connection_closed"),cleanup.run("connection_error")]);
    expect(order).toEqual(["flush","checkpoint","finalize","close"]);expect(getSession(s.id)).toBeNull();registry.close();
  });
  it.each(["flush","checkpoint"])("failed %s never marks a recoverable checkpoint; safe drain still permits the original end attempt",async stage=>{
    const s=createSession(claims()),registry=new DisconnectFinalizerRegistry(30000,()=>{}),finalize=vi.fn(),close=vi.fn(),onError=vi.fn();
    const cleanup=new RealtimeConnectionCleanup({session:s,generation:1,publicImmediateFinalization:true,
      finalizer:{flush:async()=>{if(stage==="flush")throw Error("synthetic flush failure");return {} as any;},finalize},
      checkpointDisconnect:async()=>{throw Error("synthetic checkpoint failure");},provider:{closeSession:close},sessionSync:{drain:async()=>{}},disconnectFinalizers:registry,closeClient:()=>{},onError});
    await cleanup.run("connection_closed");expect(finalize).toHaveBeenCalledTimes(stage==="flush"?0:1);expect(s.publicDisconnect).toBeUndefined();expect(close).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledTimes(1);registry.close();
  });
  it("old cleanup completion cannot close or delete a newer connection generation",async()=>{
    const s=createSession(claims()),registry=new DisconnectFinalizerRegistry(30000,()=>{}),close=vi.fn(),finalize=vi.fn();
    const cleanup=new RealtimeConnectionCleanup({session:s,generation:1,publicImmediateFinalization:true,
      finalizer:{flush:async()=>({} as any),finalize},checkpointDisconnect:async()=>{s.connectionGeneration=2;return receipt();},provider:{closeSession:close},sessionSync:{drain:async()=>{}},disconnectFinalizers:registry,closeClient:()=>{},onError:()=>{}});
    await cleanup.run("connection_closed");expect(getSession(s.id)).toBe(s);expect(close).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled();registry.close();
  });
});
