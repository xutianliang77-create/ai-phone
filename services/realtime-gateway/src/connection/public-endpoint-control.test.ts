import {afterEach,describe,it,expect,vi} from "vitest";
import type {AudioFrame,RealtimeTokenClaims,ServerRealtimeEvent} from "@translation/contracts";
import {AudioFrameBatcher} from "./audio-frame-batcher.js";
import {handleAudioBoundary} from "./audio-boundary-control.js";
import {handleControlEvent} from "./session-control-handler.js";
import {createSession,deleteSession,getSession} from "../sessions/session-manager.js";
import type {RealtimeProvider} from "../providers/realtime-provider.js";
import {RealtimeSessionFinalizer} from "./realtime-session-finalizer.js";
import {RealtimeFlushTracker} from "./realtime-flush-tracker.js";
const frame=(sequence=1):AudioFrame=>({type:"audio.frame",sessionId:"control",sequence,timestampMs:123456789,format:"pcm16",sampleRate:24000,data:Buffer.alloc(4800).toString("base64")});
const claims=():RealtimeTokenClaims=>({sessionId:"control",userId:"owner",sourceLanguage:"fr",targetLanguage:"ja",voiceOutput:false,planCode:"free",maxDurationSeconds:120,issuedAt:0,expiresAt:9999999999});
function gate<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
const batchers:AudioFrameBatcher[]=[];
function fixture(){
  createSession(claims());const order:string[]=[],events:ServerRealtimeEvent[]=[],onError=vi.fn();
  const provider:RealtimeProvider={name:"synthetic",createSession:async()=>{},closeSession:vi.fn(async()=>{}),healthCheck:async()=>false,
    async *sendAudio(f){order.push(`audio:${f.sequence}`);},async *flushSession(){order.push("commit");yield {type:"transcript.final",sessionId:"control",segmentId:"s",text:"Bonjour",language:"fr"};}};
  const batcher=new AudioFrameBatcher({sessionId:"control",provider,send:e=>events.push(e),onError,batchDelayMs:10000});batchers.push(batcher);
  const options={sessionId:"control",confirmed:true,batcher,provider,beforeFlush:async()=>{order.push("confirm");},drain:async()=>{order.push("drain");},send:(e:ServerRealtimeEvent)=>events.push(e)};
  return {provider,batcher,order,events,options,onError};
}
afterEach(async()=>{for(const b of batchers.splice(0)){b.stopAccepting();try{await b.flush();}catch{}}deleteSession("control");vi.restoreAllMocks();});
describe("public endpoint ordering on original control and batching",()=>{
  it("keeps later audio behind the synchronous boundary reservation",async()=>{
    const f=fixture();f.batcher.enqueue(frame());f.batcher.enqueue(frame(2));
    const boundary=handleAudioBoundary({type:"audio.boundary",sessionId:"control",sequence:2},f.options);f.batcher.enqueue(frame(3));
    await f.batcher.flush();await boundary;expect(f.order).toEqual(["audio:2","confirm","commit","drain","audio:3"]);
    expect(f.events.at(-1)).toMatchObject({type:"audio.boundary.committed",sequence:2});
  });
  it("does not let an already-running force drain steal audio after the boundary",async()=>{
    const f=fixture(),entered=gate(),release=gate();f.provider.sendAudio=async function*(audio){f.order.push(`audio:${audio.sequence}`);if(audio.sequence===1){entered.resolve();await release.promise;}};
    f.batcher.enqueue(frame());const flushing=f.batcher.flush();await entered.promise;f.batcher.enqueue(frame(2));
    const boundary=handleAudioBoundary({type:"audio.boundary",sessionId:"control",sequence:2},f.options);f.batcher.enqueue(frame(3));release.resolve();
    await flushing;await boundary;await f.batcher.flush();expect(f.order).toEqual(["audio:1","audio:2","confirm","commit","drain","audio:3"]);
  });
  it("acknowledges duplicate boundaries without repeating inference",async()=>{
    const f=fixture();f.batcher.enqueue(frame());const event={type:"audio.boundary" as const,sessionId:"control",sequence:1};
    await Promise.all([handleAudioBoundary(event,f.options),handleAudioBoundary(event,f.options)]);expect(f.order.filter(v=>v==="commit")).toHaveLength(1);
    expect(f.events.filter(e=>e.type==="audio.boundary.committed")).toHaveLength(2);
  });
  it.each(["future","past","foreign","private","unknown_fields"])("rejects %s boundary without model work",async kind=>{
    const f=fixture();f.batcher.enqueue(frame());let event:any={type:"audio.boundary",sessionId:"control",sequence:1};
    if(kind==="future")event.sequence=2;if(kind==="past")event.sequence=0;if(kind==="foreign")event.sessionId="other";
    if(kind==="private")f.options.confirmed=false;if(kind==="unknown_fields")event.audioEndSample=999;
    await handleAudioBoundary(event,f.options);expect(f.order).toEqual([]);expect(f.events).toEqual([expect.objectContaining({type:"audio.boundary.rejected"})]);
  });
  it("does not confirm a boundary when provider reports an error event",async()=>{
    const f=fixture();f.provider.flushSession=async function*(){yield {type:"error",sessionId:"control",code:"unavailable",message:"failed"};};f.batcher.enqueue(frame());
    await handleAudioBoundary({type:"audio.boundary",sessionId:"control",sequence:1},f.options);expect(f.events.at(-1)?.type).toBe("audio.boundary.rejected");
    await expect(f.batcher.flush()).rejects.toThrow("boundary_failed");
  });
  it("fails the boundary if prior public audio confirmation failed",async()=>{
    const f=fixture();const b=new AudioFrameBatcher({sessionId:"control",provider:f.provider,send:()=>{},onError:()=>{},beforeSend:async()=>{throw Error("unconfirmed");}});batchers.push(b);
    b.enqueue(frame());await expect(b.flush()).rejects.toThrow("pipeline_failed");await handleAudioBoundary({type:"audio.boundary",sessionId:"control",sequence:1},{...f.options,batcher:b});
    expect(f.order).not.toContain("commit");expect(f.events.at(-1)?.type).toBe("audio.boundary.rejected");
  });
  it("public pause drains while active, then confirms pause; later audio is not accepted",async()=>{
    const f=fixture(),entered=gate(),release=gate();f.provider.flushSession=async function*(){expect(getSession("control")?.status).toBe("active");entered.resolve();await release.promise;};
    f.batcher.enqueue(frame());const pause=handleControlEvent({type:"session.pause",sessionId:"control"},"control",f.provider,f.batcher,f.options.send,async()=>{},undefined,{beforeFlush:f.options.beforeFlush,drain:f.options.drain});
    await entered.promise;expect(f.events.some(e=>e.type==="session.paused")).toBe(false);f.batcher.enqueue(frame(2));release.resolve();await pause;
    expect(f.events.at(-1)?.type).toBe("session.paused");expect(getSession("control")?.status).toBe("paused");expect(f.batcher.diagnostics().receivedFrameCount).toBe(1);
  });
  it("resume does not reopen audio until the confirmation drain succeeds",async()=>{
    const f=fixture();await handleControlEvent({type:"session.pause",sessionId:"control"},"control",f.provider,f.batcher,f.options.send,async()=>{},undefined,{beforeFlush:f.options.beforeFlush,drain:f.options.drain});
    const release=gate(),resume=handleControlEvent({type:"session.resume",sessionId:"control"},"control",f.provider,f.batcher,f.options.send,async()=>{},undefined,{beforeFlush:f.options.beforeFlush,drain:()=>release.promise});
    f.batcher.enqueue(frame());expect(f.batcher.diagnostics().receivedFrameCount).toBe(0);release.resolve();await resume;f.batcher.enqueue(frame());expect(f.batcher.diagnostics().receivedFrameCount).toBe(1);
  });
  it("failed public pause closes models and cannot be resumed as if successful",async()=>{
    const f=fixture();f.provider.flushSession=async function*(){throw Error("failed");};
    await expect(handleControlEvent({type:"session.pause",sessionId:"control"},"control",f.provider,f.batcher,f.options.send,async()=>{},undefined,{beforeFlush:f.options.beforeFlush,drain:f.options.drain})).rejects.toThrow();
    expect(f.provider.closeSession).toHaveBeenCalled();expect(f.events.some(e=>e.type==="session.paused")).toBe(false);
    await expect(handleControlEvent({type:"session.resume",sessionId:"control"},"control",f.provider,f.batcher,f.options.send,async()=>{},undefined,{beforeFlush:f.options.beforeFlush,drain:f.options.drain})).rejects.toThrow("recovery_required");
  });
  it("does not emit session.ended when a confirmed final flush fails",async()=>{
    const f=fixture();f.provider.flushSession=async function*(){yield {type:"error",sessionId:"control",code:"failed",message:"failed"};};
    const finalizer=new RealtimeSessionFinalizer({sessionId:"control",provider:f.provider,audioBatcher:f.batcher,send:f.options.send,
      drainSessionSync:f.options.drain,flushTracker:new RealtimeFlushTracker(),onError:()=>{},confirmed:{beforeFlush:f.options.beforeFlush}});
    await expect(finalizer.finalize("user_request")).rejects.toThrow("final_flush_unconfirmed");expect(f.provider.closeSession).toHaveBeenCalled();
    expect(f.events.some(e=>e.type==="session.ended")).toBe(false);
  });
});
