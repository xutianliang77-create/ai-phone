import {afterEach,describe,expect,it,vi} from "vitest";
import {deviceSpeakerProfile,type AudioFrame,type ServerRealtimeEvent} from "@translation/contracts";
import {SpeakerAwareAsrProvider} from "../../asr/speaker-aware-asr-provider.js";
import {DeviceSpeakerAttributionProvider} from "../../speaker/device-speaker-attribution-provider.js";
import {DeviceSpeakerTimeline} from "../../speaker/device-speaker-timeline.js";
import {markAcceptedAudioRange} from "../../connection/accepted-audio-range.js";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";
import {RealtimeTtsOutputQueue} from "../../tts/realtime-tts-output.js";

const consume=async(stream:AsyncGenerator<ServerRealtimeEvent>)=>{const events=[];for await(const e of stream)events.push(e);return events;};
function fixture(){
  const session={sessionId:"late",sourceLanguage:"auto" as const,targetLanguage:"en" as const,voiceOutput:false,
    asrEndpointMode:"conversation" as const,speakerAttribution:{mode:"diarization" as const,maxSpeakers:4 as const,
      deviceProfile:deviceSpeakerProfile.id,allowVoiceIdentity:false}};
  const originals=["我们要测试 Qwen3 ASR。","Hy-MT2 和 VoxCPM2 的在线模型链路。"].map((text,i)=>({
    segmentId:i===0?"a":"b",revision:1,text,language:"zh" as const,automaticLanguageStatus:"detected" as const,isFinal:true,
    timing:{startMs:i*1000,endMs:(i+1)*1000,source:"estimated" as const}}));
  let call=0,sequence=0,evidenceSequence=0;
  const base={createSession:vi.fn(async()=>{}),closeSession:vi.fn(async()=>{}),healthCheck:async()=>true,
    transcribe:vi.fn(async()=>structuredClone(originals[call++]??null)),flush:vi.fn(async()=>null),commitBoundary:vi.fn(async()=>null)};
  const device=new DeviceSpeakerAttributionProvider(session.sessionId,16000);
  const asr=new SpeakerAwareAsrProvider(base,device,undefined,undefined,{enabled:false,maxSessions:0,maxDurationMs:0,maxRecords:0});
  const translate=vi.fn(async(input:{text:string})=>`Translated: ${input.text}`);
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"configured-mt",timeoutMs:1000,
    publicSession:session,asrProvider:asr,deviceSpeakerReceiver:device.accept.bind(device),
    deviceSpeakerRefresh:parts=>device.refresh(parts,asr.deviceSpeakerBoundaryGuards(session.sessionId)),
    translationClient:{translate,supportsAttemptContext:true,healthCheck:async()=>true}});
  const labels:ServerRealtimeEvent[]=[],timeline=new DeviceSpeakerTimeline(session.sessionId,e=>labels.push(e),
    ()=>provider.deviceSpeakerBoundaryGuards(session.sessionId));
  async function feed(){
    const n=++sequence,frame:AudioFrame={type:"audio.frame",sessionId:session.sessionId,sequence:n,timestampMs:n*1000,
      format:"pcm16",sampleRate:16000,data:Buffer.alloc(32000).toString("base64")};
    markAcceptedAudioRange(frame,{startSample:(n-1)*16000,endSample:n*16000});
    const events=await consume(provider.sendAudio(frame));events.forEach(e=>timeline.observe(e));return events;
  }
  function evidence(parts:Array<[number,number,number]>,throughMs=2000){
    const event={type:"speaker.evidence" as const,sessionId:session.sessionId,profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
      sampleRate:16000 as const,sequence:++evidenceSequence,throughSample:throughMs*16,
      spans:parts.map(([speaker,start,end])=>({speaker,startSample:start*16,endSample:end*16,confidence:.98,overlap:false}))};
    expect(provider.acceptDeviceSpeakerEvidence(event,sequence*16000)).toBe(true);timeline.accept(event);
  }
  return {provider,session,base,translate,feed,evidence,labels};
}
afterEach(()=>vi.useRealTimers());
describe("late validated phone evidence and original public semantic assembly",()=>{
  it.each(["next_audio","finish"])("repairs two emitted fragments on %s without a second ASR",async trigger=>{
    vi.useFakeTimers();vi.setSystemTime(10000);const f=fixture();await f.provider.createSession(f.session);
    try{
      expect((await f.feed())[0]).toMatchObject({segmentId:"a",revision:1,speaker:{speakerId:"unknown"}});
      vi.setSystemTime(11000);await f.feed();f.evidence([[0,0,2000]]);vi.setSystemTime(12000);
      const events=trigger==="finish"?await consume(f.provider.flushSession("late",{finishSession:true})):await f.feed();
      expect(events.filter(e=>e.type==="transcript.final")).toMatchObject([
        {segmentId:"b",text:"",revision:2},
        {segmentId:"a",revision:2,text:"我们要测试 Qwen3 ASR、Hy-MT2 和 VoxCPM2 的在线模型链路。",speaker:{speakerId:"device-speaker-1"}},
      ]);
      expect(f.translate).toHaveBeenCalledTimes(3);expect(f.base.createSession).toHaveBeenCalledTimes(1);
      expect(f.base.commitBoundary).not.toHaveBeenCalled();
      expect(await consume(f.provider.flushSession("late",{finishSession:true}))).toEqual([]);
      expect(f.translate).toHaveBeenCalledTimes(3);
    }finally{await f.provider.closeSession("late");}
  });
  it("uses evidence arriving before the second final without re-translating the first alone",async()=>{
    vi.useFakeTimers();vi.setSystemTime(10000);const f=fixture();await f.provider.createSession(f.session);
    try{
      await f.feed();f.evidence([[0,0,1000]],1000);vi.setSystemTime(11000);
      // The second final is initially ahead of the diarizer; it must remain revisable.
      await f.feed();f.evidence([[0,1000,2000]]);const events=await f.feed();
      expect(events.find(e=>e.type==="translation.final")).toMatchObject({segmentId:"a",revision:2});
      expect(f.translate).toHaveBeenCalledTimes(3);
    }finally{await f.provider.closeSession("late");}
  });
  it.each(["expired","different_speakers","short_rival","incomplete_evidence"])("does not repair %s",async scenario=>{
    vi.useFakeTimers();vi.setSystemTime(10000);const f=fixture();await f.provider.createSession(f.session);
    try{
      await f.feed();vi.setSystemTime(11000);await f.feed();
      if(scenario==="different_speakers")f.evidence([[0,0,1000],[1,1000,2000]]);
      else if(scenario==="short_rival")f.evidence([[1,0,135],[0,135,2000]]);
      else if(scenario==="incomplete_evidence")f.evidence([[0,0,1800]],1800);
      else f.evidence([[0,0,2000]]);
      vi.setSystemTime(scenario==="expired"?15001:12000);
      expect((await f.feed()).filter(e=>e.type==="translation.final")).toEqual([]);
      expect(f.translate).toHaveBeenCalledTimes(2);
    }finally{await f.provider.closeSession("late");}
  });
  it("does not invoke MT for a label-only refresh",async()=>{
    const f=fixture();await f.provider.createSession(f.session);
    try{
      await f.feed();f.evidence([[0,0,1000]],1000);
      expect(f.labels).toMatchObject([{type:"speaker.updated",segmentId:"a",speakerRevision:1}]);
      expect(await consume(f.provider.flushSession("late",{finishSession:false}))).toEqual([]);
      expect(f.translate).toHaveBeenCalledTimes(1);
    }finally{await f.provider.closeSession("late");}
  });
  it("reuses TTS generation cancellation for late text repair and does not replay absorbed speech",async()=>{
    const f=fixture();await f.provider.createSession(f.session);
    let release!:()=>void,entered!:()=>void;
    const blocked=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
    const sent:ServerRealtimeEvent[]=[],calls:Array<[string,number|undefined]>=[];
    const queue=new RealtimeTtsOutputQueue({sessionId:"late",voiceOutput:true,isSessionActive:()=>true,retireSupersededSegments:true,
      synthesizer:{enabled:true,cancelSession:vi.fn(),closeSession:vi.fn(),async *synthesizeStream(event){
        calls.push([event.segmentId,event.revision]);if(event.segmentId==="a"&&event.revision===1){entered();await blocked;}
        yield {type:"audio.output",sessionId:"late",segmentId:event.segmentId,revision:event.revision,sequence:1,
          format:"pcm16",sampleRate:16000,data:"AAA=",isFinal:true};
      }}});
    const enqueue=(events:ServerRealtimeEvent[])=>events.forEach(e=>queue.enqueue(e,e=>sent.push(e)));
    try{
      enqueue(await f.feed());await started;enqueue(await f.feed());f.evidence([[0,0,2000]]);
      const repaired=await f.feed();enqueue(repaired);release();await queue.drain();await queue.drainInFlight();
      expect(sent.filter(e=>e.type==="audio.output").map(e=>[e.segmentId,e.revision])).toEqual([["a",2]]);
      enqueue(repaired);await queue.drain();expect(calls).toEqual([["a",1],["a",2]]);
    }finally{release();queue.close();await queue.drainInFlight();await f.provider.closeSession("late");}
  });
});
