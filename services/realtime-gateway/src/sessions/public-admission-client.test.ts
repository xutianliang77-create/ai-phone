import {afterEach,describe,it,expect,vi} from "vitest";
import type {RealtimeTokenClaims,PublicAdmissionQuery} from "@translation/contracts";
import {createPublicAdmissionClient} from "./public-admission-client.js";
import {createSessionEventSink} from "./session-event-sink.js";
import type {RealtimeEnv} from "../config/env.js";
const claims=():RealtimeTokenClaims=>({userId:"owner",sessionId:"session",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,planCode:"free",
  issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+300,maxDurationSeconds:60,
  processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",publicGrantRef:"grant",syncPermission:{allowed:false},
    languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},executionPlan:{asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}}},
  publicRuntime:{deploymentId:"public",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationHash:"a".repeat(64),configurationRevision:1}});
function setup(patch:Partial<RealtimeEnv>={}){
  const fetchFn=vi.fn(async(_url:any,init:any)=>{const q=JSON.parse(init.body);return new Response(JSON.stringify({...q,allowed:true,
    checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),maxActiveSeconds:60,status:q.purpose==="connect"?"created":"active"}));});
  const env={sessionEventSink:"api",apiBaseUrl:"https://synthetic.invalid",internalApiSecret:"SYNTHETIC_INTERNAL_SECRET",sessionSyncTimeoutMs:250,...patch} as RealtimeEnv;
  return {fetchFn,client:createPublicAdmissionClient(createSessionEventSink(env,fetchFn),claims(),"public")};
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe("read-only current admission through the original API sink",()=>{
  it("makes a fresh nonce-bound lookup each time without sending tokens or model credentials",async()=>{
    const s=setup(),a=await s.client.authorize("connect"),b=await s.client.authorize("dispatch");
    expect(a.requestId).not.toBe(b.requestId);expect(s.fetchFn).toHaveBeenCalledTimes(2);
    for(const [url,init] of s.fetchFn.mock.calls){expect(url).toBe("https://synthetic.invalid/internal/realtime/sessions/session/admission");expect(init.redirect).toBe("error");
      expect(init.body).not.toMatch(/realtimeToken|apiKey|SYNTHETIC/);}
  });
  it.each(["ownerId","requestId","captureId","configurationHash","purpose","expired","stale","extra","allowed"])("rejects mismatched %s response",async kind=>{
    const s=setup();s.fetchFn.mockImplementation(async(_u,init)=>{const q=JSON.parse(init.body),r:any={...q,allowed:true,checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),maxActiveSeconds:60,status:"created"};
      if(kind==="expired")r.expiresAt=new Date(0).toISOString();else if(kind==="stale")r.checkedAt=new Date(0).toISOString();else if(kind==="extra")r.apiKey="FORBIDDEN";
      else if(kind==="allowed")r.allowed=false;else r[kind]="wrong";return new Response(JSON.stringify(r));});
    await expect(s.client.authorize("connect")).rejects.toThrow("ack_mismatch");expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it.each([401,403,503])("does not retry HTTP %i or expose its body",async status=>{
    const s=setup();s.fetchFn.mockResolvedValue(new Response("PRIVATE_ERROR",{status}));await expect(s.client.authorize("connect")).rejects.toThrow(`HTTP ${status}`);expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it.each(["transport","body"])("bounds stalled %s and cancels the request",async phase=>{
    vi.useFakeTimers();const s=setup();let cancelled=false;
    s.fetchFn.mockImplementation(()=>phase==="transport"?new Promise(()=>{}):Promise.resolve(new Response(new ReadableStream({cancel(){cancelled=true;}}))));
    const check=expect(s.client.authorize("connect")).rejects.toThrow();await vi.advanceTimersByTimeAsync(251);await check;
    expect(s.fetchFn.mock.calls[0][1].signal.aborted).toBe(true);if(phase==="body")expect(cancelled).toBe(true);
  });
  it("rejects an oversized response",async()=>{const s=setup();s.fetchFn.mockResolvedValue(new Response("x".repeat(262145)));await expect(s.client.authorize("connect")).rejects.toThrow();});
  it.each(["http://private.invalid","https://user:password@invalid.test","https://invalid.test?api_key=forbidden"])("does not send internal credentials to invalid transport %s",async apiBaseUrl=>{
    const s=setup({apiBaseUrl});await expect(s.client.authorize("connect")).rejects.toThrow("transport_required");expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("refuses a no-op sink and independently checks custom sink receipts",async()=>{
    expect(()=>createPublicAdmissionClient(createSessionEventSink({sessionEventSink:"noop"} as any),claims(),"public")).toThrow("not_bound");
    const client=createPublicAdmissionClient({record:async()=>{},touch:async()=>{},admission:async(_q:PublicAdmissionQuery)=>({allowed:true} as any)},claims(),"public");
    await expect(client.authorize("connect")).rejects.toThrow("ack_mismatch");
  });
  it("uses a separate read-only recovery inspection without granting connect or dispatch",async()=>{
    const s=setup();s.fetchFn.mockImplementation(async(_url,init)=>{
      const q=JSON.parse(init.body);expect(q.purpose).toBe("recovery");
      return new Response(JSON.stringify({...q,allowed:true,status:"paused",checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),maxActiveSeconds:60,
        recovery:{runtimeSequence:5,lastAcceptedSample:32000,finalRevision:4,activeMs:2000,recoveryUntil:new Date(Date.now()+30000).toISOString()}}));
    });
    const a=await s.client.inspectRecovery(),b=await s.client.inspectRecovery();expect(a.requestId).not.toBe(b.requestId);
    expect(a.recovery?.lastAcceptedSample).toBe(32000);expect(s.fetchFn).toHaveBeenCalledTimes(2);
    await expect(s.client.authorize("recovery" as any)).rejects.toThrow("purpose_invalid");expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });
  it.each(["missing","wrongNonce","invalidWatermark","connectReply"])("rejects %s recovery responses without retry",async kind=>{
    const s=setup();s.fetchFn.mockImplementation(async(_url,init)=>{
      const q=JSON.parse(init.body),r:any={...q,allowed:true,status:"paused",checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),maxActiveSeconds:60,
        recovery:{runtimeSequence:5,lastAcceptedSample:32000,finalRevision:4,activeMs:2000,recoveryUntil:new Date(Date.now()+30000).toISOString()}};
      if(kind==="missing")delete r.recovery;if(kind==="wrongNonce")r.requestId="old";if(kind==="invalidWatermark")r.recovery.lastAcceptedSample=-1;
      if(kind==="connectReply"){r.purpose="connect";r.status="created";delete r.recovery;}
      return new Response(JSON.stringify(r));
    });
    await expect(s.client.inspectRecovery()).rejects.toThrow("ack_mismatch");expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
});
