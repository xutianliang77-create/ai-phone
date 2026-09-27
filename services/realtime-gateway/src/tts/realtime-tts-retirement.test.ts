import {describe,expect,it,vi} from "vitest";
import type {ServerRealtimeEvent} from "@translation/contracts";
import {RealtimeTtsOutputQueue} from "./realtime-tts-output.js";
const event=(id:string,revision=1)=>({type:"translation.final",sessionId:"s",segmentId:id,revision,text:"Synthetic.",language:"en"} as const);
const tombstone=(id:string,revision=2)=>({type:"transcript.final",sessionId:"s",segmentId:id,revision,text:"",language:"en"} as const);
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
function fixture(retireSupersededSegments=true){
  const entered=deferred(),release=deferred(),sent:ServerRealtimeEvent[]=[],calls:string[]=[],cancel=vi.fn();
  const queue=new RealtimeTtsOutputQueue({sessionId:"s",voiceOutput:true,isSessionActive:()=>true,retireSupersededSegments,
    synthesizer:{enabled:true,cancelSession:cancel,closeSession:vi.fn(),async *synthesizeStream(e){
      calls.push(`${e.segmentId}:${e.revision}`);if(e.segmentId==="a"&&e.revision===1){entered.resolve();await release.promise;}
      yield {type:"audio.output",sessionId:"s",segmentId:e.segmentId,revision:e.revision,sequence:1,
        format:"pcm16",sampleRate:16000,data:"AAA=",isFinal:true};
    }}});
  return {queue,entered,release,sent,calls,cancel,enqueue:(e:ServerRealtimeEvent)=>queue.enqueue(e,e=>sent.push(e)),
    cleanup:async()=>{release.resolve();queue.close();await queue.drainInFlight();}};
}
describe("public empty-final retirement preserves unrelated speech",()=>{
  it.each(["active","queued"])("cancels an absorbed %s segment and retains unrelated pending output",async which=>{
    const f=fixture();try{
      f.enqueue(event("a"));await f.entered.promise;f.enqueue(event("b"));f.enqueue(event("c"));
      f.enqueue(tombstone(which==="active"?"a":"b"));f.release.resolve();await f.queue.drain();await f.queue.drainInFlight();
      expect(f.sent.filter(e=>e.type==="audio.output").map(e=>e.segmentId)).toEqual(which==="active"?["b","c"]:["a","c"]);
      expect(f.cancel).toHaveBeenCalledTimes(which==="active"?1:0);
    }finally{await f.cleanup();}
  });
  it("rejects stale, duplicate and unversioned resurrection but admits a genuine newer correction",async()=>{
    const f=fixture();try{
      f.enqueue(tombstone("b"));f.enqueue(event("b",1));f.enqueue(event("b",2));
      f.enqueue({...event("b"),revision:undefined});await f.queue.drain();expect(f.calls).toEqual([]);
      f.enqueue(event("b",3));f.enqueue(tombstone("b",2));await f.queue.drain();
      expect(f.calls).toEqual(["b:3"]);
    }finally{await f.cleanup();}
  });
  it("does not accept another session, invalid revisions, or a nonempty transcript as retirement",async()=>{
    const f=fixture();try{
      f.enqueue({...tombstone("b"),sessionId:"other"});f.enqueue({...tombstone("b"),revision:undefined});
      f.enqueue({...tombstone("b"),revision:-1});f.enqueue({...tombstone("b"),text:"Still valid."});
      f.enqueue(event("b"));await f.queue.drain();expect(f.calls).toEqual(["b:1"]);
    }finally{await f.cleanup();}
  });
  it("preserves the default private queue behavior",async()=>{
    const f=fixture(false);try{f.enqueue(tombstone("b"));f.enqueue(event("b"));await f.queue.drain();expect(f.calls).toEqual(["b:1"]);}
    finally{await f.cleanup();}
  });
});
