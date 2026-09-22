import {it,expect,vi} from "vitest";
import type {AudioFrame,ServerRealtimeEvent,PublicModelAttemptEvent} from "@translation/contracts";
import {OpenAiStreamingAsrClient} from "../asr/openai-streaming-asr-client.js";
import {HttpAsrProvider} from "../asr/http-asr-provider.js";
import {SpeakerAwareAsrProvider} from "../asr/speaker-aware-asr-provider.js";
import {DeviceSpeakerAttributionProvider} from "../speaker/device-speaker-attribution-provider.js";
import {SyntheticQwenAsrSocket} from "../asr/qwen-streaming-asr.test-support.js";
import {LmStudioRealtimeProvider} from "./lmstudio/lmstudio-realtime-provider.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";
import {RealtimeFlushTracker} from "../connection/realtime-flush-tracker.js";
import {RealtimeSessionFinalizer} from "../connection/realtime-session-finalizer.js";
import {claims} from "../connection/realtime-session-finalizer.test-support.js";
import {createSession,deleteSession,getSession} from "../sessions/session-manager.js";

function setup(language:string,tail=false){
  const session={sessionId:"language-notice",sourceLanguage:"auto" as const,targetLanguage:"zh" as const,
    automaticSourceLanguages:["zh","en"] as const,asrEndpointMode:"listening" as const,voiceOutput:false};
  const record=vi.fn(async(_event:PublicModelAttemptEvent)=>{}),translate=vi.fn(async()=>"正常翻译。");
  let socket:SyntheticQwenAsrSocket;
  const socketFactory=vi.fn(()=>{socket=new SyntheticQwenAsrSocket();socket.model="model";socket.language=language;socket.transcript="UNSUPPORTED_TEXT";socket.autoComplete=!tail;
    const partial=socket.partial.bind(socket);socket.partial=(id,text,stash)=>{const actual=socket.language;socket.language="en";partial(id,text,stash);socket.language=actual;};return socket.asWebSocket();});
  const client=new OpenAiStreamingAsrClient({sessionId:session.sessionId,leaseId:"lease",endpoint:"wss://synthetic.invalid",model:"model",language:"auto",timeoutMs:1000,
    wireProfile:"qwen_asr_realtime",automaticSourceLanguages:["zh","en"],authorizeConnection:async()=>{},resolveCredentials:()=>({apiKey:"SYNTHETIC"}),record,socketFactory});
  const base=new HttpAsrProvider({endpoint:"wss://synthetic.invalid",timeoutMs:1000,client});
  const asr=new SpeakerAwareAsrProvider(base,new DeviceSpeakerAttributionProvider(session.sessionId,16000),undefined,undefined,{enabled:false,maxSessions:0,maxDurationMs:0,maxRecords:0});
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"mt",timeoutMs:1000,asrProvider:asr,
    publicSession:session,translationClient:{translate,healthCheck:async()=>true}});
  const frame=(i:number)=>{const f:AudioFrame={type:"audio.frame",sessionId:session.sessionId,sequence:i,timestampMs:i*100,format:"pcm16",sampleRate:16000,data:Buffer.alloc(3200).toString("base64")};markAcceptedAudioRange(f,{startSample:i*1600,endSample:(i+1)*1600});return f;};
  return {session,record,translate,socketFactory,provider,frame,socket:()=>socket!};
}
it.each(["da","fil","fi","is","no","sv"])("continues after supplier-valid %s without inventing a language or calling MT/TTS",async language=>{
  const t=setup(language),events:ServerRealtimeEvent[]=[];
  try{
    await t.provider.createSession(t.session);t.provider.setEventListener(t.session.sessionId,e=>events.push(e));
    for await(const e of t.provider.sendAudio(t.frame(0)))events.push(e);
    expect(t.translate).not.toHaveBeenCalled();expect(events.some(e=>e.type==="translation.final"||e.type==="audio.output"||e.type==="error")).toBe(false);
    const notices=events.filter(e=>e.type==="translation.failed");expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({stage:"translation",retryable:false,message:expect.stringContaining(`（${language}）`)});
    const draft=events.find(e=>e.type==="transcript.partial")!;
    expect(events).toContainEqual(expect.objectContaining({type:"transcript.final",segmentId:(draft as any).segmentId,text:""}));
    expect(events.some(e=>e.type==="transcript.final"&&e.text==="UNSUPPORTED_TEXT")).toBe(false);
    t.socket().language="en";t.socket().transcript="Good morning.";
    for await(const e of t.provider.sendAudio(t.frame(1)))events.push(e);
    for await(const e of t.provider.flushSession(t.session.sessionId,{finishSession:true}))events.push(e);
    expect(t.translate).toHaveBeenCalledTimes(1);expect(t.translate).toHaveBeenCalledWith(expect.objectContaining({sourceLanguage:"en",targetLanguage:"zh"}));
    expect(events.some(e=>e.type==="error")).toBe(false);expect(events.filter(e=>e.type==="translation.failed")).toHaveLength(1);
    expect(t.socketFactory).toHaveBeenCalledTimes(1);expect(t.record.mock.calls.filter(([e])=>e.state==="confirmed")).toHaveLength(1);
    expect(t.record.mock.calls.some(([e])=>e.state==="uncertain")).toBe(false);
  }finally{await t.provider.closeSession(t.session.sessionId);}
});
it("drains a language notice at final flush without turning the confirmed ASR attempt into a failure",async()=>{
  const t=setup("da",true),tracker=new RealtimeFlushTracker(),events:ServerRealtimeEvent[]=[];
  try{
    await t.provider.createSession(t.session);for await(const e of t.provider.sendAudio(t.frame(0)))events.push(e);
    tracker.beginFinalization();for await(const e of t.provider.flushSession(t.session.sessionId,{finishSession:true})){events.push(e);tracker.record(e);}
    expect(events.filter(e=>e.type==="translation.failed")).toHaveLength(1);expect(events.filter(e=>e.type==="error")).toEqual([]);
    expect(tracker.summarize({audioFlushed:true,providerFlushed:true})).toMatchObject({status:"degraded",translationFailedCount:1,unresolvedSegmentCount:0,pipelineErrorCount:0});
    expect(t.translate).not.toHaveBeenCalled();expect(t.record.mock.calls.at(-1)![0].state).toBe("confirmed");
  }finally{await t.provider.closeSession(t.session.sessionId);}
});
it.each(["xx", "not-a-code"])("retains fail-closed behavior for malformed or unknown supplier language %s",async language=>{
  const t=setup(language),events:ServerRealtimeEvent[]=[];
  try{await t.provider.createSession(t.session);for await(const e of t.provider.sendAudio(t.frame(0)))events.push(e);
    expect(events.some(e=>e.type==="error"&&e.stage==="asr")).toBe(true);expect(t.translate).not.toHaveBeenCalled();
  }finally{await t.provider.closeSession(t.session.sessionId);}
});
it("the original confirmed finalizer ends an unsupported tail once and does not replay ASR",async()=>{
  const t=setup("da",true),events:ServerRealtimeEvent[]=[],tracker=new RealtimeFlushTracker();
  deleteSession(t.session.sessionId);const managed=createSession({...claims(),sessionId:t.session.sessionId});
  const onError=vi.fn(),beforeFlush=vi.fn(async()=>{}),stopUncertain=vi.fn(async()=>{});
  try{
    await t.provider.createSession(t.session);for await(const _e of t.provider.sendAudio(t.frame(0))){}
    const finalizer=new RealtimeSessionFinalizer({sessionId:managed.id,provider:t.provider,
      audioBatcher:{stopAccepting:()=>{},flush:async()=>{}},send:e=>{tracker.record(e);events.push(e);},
      drainSessionSync:async()=>{},flushTracker:tracker,onError,confirmed:{beforeFlush,stopUncertain}});
    await Promise.all([finalizer.finalize("client_request"),finalizer.finalize("connection_closed")]);
    expect(events.filter(e=>e.type==="session.ended")).toHaveLength(1);
    expect(events.find(e=>e.type==="session.ended")).toMatchObject({flush:{status:"degraded",translationFailedCount:1,unresolvedSegmentCount:0}});
    expect(getSession(managed.id)?.status).toBe("ended");expect(stopUncertain).not.toHaveBeenCalled();expect(onError).not.toHaveBeenCalled();
    expect(t.record.mock.calls.filter(([e])=>e.state==="confirmed")).toHaveLength(1);expect(t.socketFactory).toHaveBeenCalledTimes(1);
    expect(t.socket().sent.filter(e=>e.type==="session.finish")).toHaveLength(1);
  }finally{await t.provider.closeSession(t.session.sessionId);deleteSession(managed.id);}
});
