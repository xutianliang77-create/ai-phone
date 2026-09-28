import {it,expect,vi} from "vitest";
import type {ServerRealtimeEvent} from "@translation/contracts";
import {handlePublicSpeechStart} from "./public-speech-start.js";
import {AudioFrameBatcher} from "./audio-frame-batcher.js";
import {RealtimeTtsOutputQueue} from "../tts/realtime-tts-output.js";
import {createSession,deleteSession} from "../sessions/session-manager.js";
import {claims} from "./realtime-session-finalizer.test-support.js";
it("binds barge-in to accepted PCM, cancels old generation once, and preserves future speech",async()=>{
  const session=createSession(claims()),sent:ServerRealtimeEvent[]=[],calls:string[]=[],cancel=vi.fn();
  const queue=new RealtimeTtsOutputQueue({sessionId:session.id,voiceOutput:true,retireSupersededSegments:true,isSessionActive:()=>true,
    synthesizer:{enabled:true,cancelSession:cancel,closeSession:vi.fn(),async *synthesizeStream(e){calls.push(e.segmentId);}}});
  const provider={name:"synthetic",createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,async *sendAudio(){}};
  const batcher=new AudioFrameBatcher({sessionId:session.id,provider,acceptFrame:()=>{},send:()=>{},onError:()=>{}});
  const options={sessionId:session.id,confirmed:true,batcher,tts:queue,send:(e:ServerRealtimeEvent)=>sent.push(e)};
  const event={type:"audio.speech_started" as const,sessionId:session.id,sequence:0};
  const source=(id:string)=>({type:"transcript.final" as const,sessionId:session.id,segmentId:id,revision:1,text:"Source",language:"en" as const});
  const translated=(id:string)=>({type:"translation.final" as const,sessionId:session.id,segmentId:id,revision:1,text:"译文",language:"zh" as const});
  try{
    handlePublicSpeechStart(event,options);expect(sent.at(-1)?.type).toBe("audio.speech_started.rejected");
    queue.enqueue(source("old"),()=>{});
    batcher.enqueue({type:"audio.frame",sessionId:session.id,sequence:0,timestampMs:0,format:"pcm16",sampleRate:16000,data:"AAA="});
    handlePublicSpeechStart(event,{...options,confirmed:false});expect(cancel).not.toHaveBeenCalled();
    handlePublicSpeechStart(event,options);expect(cancel).toHaveBeenCalledTimes(1);
    queue.enqueue(translated("old"),()=>{}); // MT was not yet queued when interrupted.
    queue.enqueue(source("new"),()=>{});queue.enqueue(translated("new"),()=>{});
    handlePublicSpeechStart(event,options);expect(cancel).toHaveBeenCalledTimes(1);
    await queue.drain();expect(calls).toEqual(["new"]);
    expect(sent.at(-1)?.type).toBe("audio.speech_started.confirmed");
    batcher.stopAccepting();handlePublicSpeechStart({...event,sequence:1},options);
    expect(sent.at(-1)?.type).toBe("audio.speech_started.rejected");
  }finally{queue.close();await batcher.close();deleteSession(session.id);}
});
