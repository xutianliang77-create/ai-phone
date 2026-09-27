import {describe,it,expect,vi} from "vitest";
import {createSessionEventSink,bindPublicSessionEventSink} from "./session-event-sink.js";
import type {RealtimeEnv} from "../config/env.js";
const input={sessionId:"session",segmentId:"child",revision:2};
const env={sessionEventSink:"api",apiBaseUrl:"https://synthetic.invalid",internalApiSecret:"synthetic-secret-not-real",sessionSyncTimeoutMs:1000} as RealtimeEnv;
describe("public retirement requires a durable exact receipt",()=>{
  it.each([{revision:2,retired:true},{revision:3,retired:true},{revision:3,retired:false}])("accepts a confirmed outcome %j",async outcome=>{
    const fetchFn=vi.fn(async(_url:unknown,_options?:RequestInit)=>new Response(JSON.stringify({...input,...outcome}),{status:200}));
    await createSessionEventSink(env,fetchFn).retireSegment!(input);
    expect(fetchFn).toHaveBeenCalledOnce();expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({...input,retired:true});
  });
  it.each([{},{sessionId:"foreign",revision:2,retired:true},{segmentId:"foreign",revision:2,retired:true},
    {revision:1,retired:true},{revision:2.5,retired:true},{revision:2,retired:false},{revision:2,retired:"true"}])("rejects a false success receipt %j",async patch=>{
    const receipt=Object.keys(patch).length?{...input,...patch}:{};
    await expect(createSessionEventSink(env,async()=>new Response(JSON.stringify(receipt),{status:200})).retireSegment!(input)).rejects.toThrow("unconfirmed");
  });
  it("retries the same idempotent retirement after a lost reply",async()=>{
    const calls:unknown[]=[];const fetchFn=vi.fn(async(_url:unknown,options?:RequestInit)=>{calls.push(JSON.parse(String(options?.body)));if(calls.length===1)throw Error("lost reply");return new Response(JSON.stringify({...input,retired:true}),{status:200});});
    await createSessionEventSink(env,fetchFn).retireSegment!(input);expect(calls).toEqual([{...input,retired:true},{...input,retired:true}]);
  });
  it("cannot announce a confirmed stop after retirement storage fails",async()=>{
    const binding={sessionId:"session",ownerId:"owner",deploymentId:"public-test",modelPolicyRevision:"policy",leaseId:"lease",captureId:"capture",languagePolicyKey:"lang",sampleRate:16000 as const};
    const runtime=vi.fn(async(_id:string,e:Record<string,unknown>)=>({...binding,...e,meterStatus:"verified"}));
    const sink=bindPublicSessionEventSink({record:async()=>{},touch:async()=>{},runtime:runtime as never,retireSegment:async()=>{throw Error("storage unavailable");}},binding);
    await sink.record({type:"session.started",sessionId:"session"});
    await expect(sink.record({type:"transcript.final",...input,text:"",language:"en"})).rejects.toThrow("storage unavailable");
    await expect(sink.record({type:"session.ended",sessionId:"session",reason:"user_request"})).rejects.toThrow();
    expect(runtime).toHaveBeenCalledOnce();
  });
});
