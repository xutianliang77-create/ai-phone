import {describe,it,expect,vi} from "vitest";
import type {AudioFrame,PublicRuntimeObservation} from "@translation/contracts";
import {markAcceptedAudioRange,acceptedAudioRange,inheritAcceptedAudioRange} from "./accepted-audio-range.js";
import {AudioFrameBatcher} from "./audio-frame-batcher.js";
import {bindPublicSessionEventSink} from "../sessions/session-event-sink.js";
const frame=(sequence=1):AudioFrame=>({type:"audio.frame",sessionId:"s",sequence,timestampMs:1788883200000,format:"pcm16",sampleRate:24000,data:Buffer.alloc(4800).toString("base64")});
describe("server-owned PCM provenance through original batcher",()=>{
  it("does not trust JSON fields or copied objects as accepted-range evidence",()=>{
    const f=frame();(f as any).acceptedAudioRange={startSample:0,endSample:2400};expect(acceptedAudioRange(f)).toBeUndefined();
    markAcceptedAudioRange(f,{startSample:0,endSample:2400});expect(acceptedAudioRange({...f})).toBeUndefined();
  });
  it("rejects mutations of accepted PCM",()=>{const f=frame();markAcceptedAudioRange(f,{startSample:0,endSample:2400});f.data=Buffer.alloc(4800,1).toString("base64");expect(()=>acceptedAudioRange(f)).toThrow("changed");});
  it("rejects noncontiguous merge and mixed accepted/unmarked frames",()=>{
    const a=frame(),b=frame(2),merged={...a,data:Buffer.alloc(9600).toString("base64")};markAcceptedAudioRange(a,{startSample:0,endSample:2400});
    expect(()=>inheritAcceptedAudioRange([a,b],merged)).toThrow("gap");markAcceptedAudioRange(b,{startSample:4800,endSample:7200});expect(()=>inheritAcceptedAudioRange([a,b],merged)).toThrow("gap");
  });
  it("original public sink stamps queue-owned frames and batcher preserves their full range",async()=>{
    const binding={sessionId:"s",ownerId:"owner",deploymentId:"public",modelPolicyRevision:"p",leaseId:"l",captureId:"c",languagePolicyKey:"k",sampleRate:24000 as const};
    const sink=bindPublicSessionEventSink({record:async()=>{},touch:async()=>{},runtime:async(_id:string,e:PublicRuntimeObservation)=>({...binding,...e,meterStatus:"verified" as const})},binding);
    await sink.record({type:"session.started",sessionId:"s"});const received:AudioFrame[]=[];const error=vi.fn();
    const batcher=new AudioFrameBatcher({sessionId:"s",provider:{name:"synthetic",createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>false,
      async *sendAudio(f){received.push(f);}},acceptFrame:f=>sink.acceptAudio(f),send:()=>{},onError:error,batchDelayMs:10000});
    try{batcher.enqueue(frame());batcher.enqueue(frame(2));await batcher.flush();expect(error).not.toHaveBeenCalled();
      expect(received).toHaveLength(1);expect(acceptedAudioRange(received[0])).toEqual({startSample:0,endSample:4800});expect(received[0].sequence).toBe(2);
    }finally{batcher.pauseAccepting();await batcher.flush();}
  });
  it("leaves private unmarked audio unchanged",()=>{const a=frame(),b=frame(2),merged={...a,data:Buffer.alloc(9600).toString("base64")};inheritAcceptedAudioRange([a,b],merged);expect(acceptedAudioRange(merged)).toBeUndefined();});
});
