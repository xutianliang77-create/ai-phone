import {afterEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {deviceSpeakerProfile,type AudioFrame,type ServerRealtimeEvent} from "@translation/contracts";
import type {TranscriptResult} from "../../asr/asr-provider.js";
import {SpeakerAwareAsrProvider} from "../../asr/speaker-aware-asr-provider.js";
import {DeviceSpeakerAttributionProvider} from "../../speaker/device-speaker-attribution-provider.js";
import {markAcceptedAudioRange} from "../../connection/accepted-audio-range.js";
import {RealtimeTtsOutputQueue} from "../../tts/realtime-tts-output.js";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";

const consume=async(events:AsyncGenerator<ServerRealtimeEvent>)=>{const result=[];for await(const e of events)result.push(e);return result;};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{resolve,promise};};
function fixture(voiceOutput=false,sourceLanguage:"auto"|"zh"="auto"){
  const session={sessionId:"object",sourceLanguage,targetLanguage:"en" as const,voiceOutput,
    asrEndpointMode:"conversation" as const,speakerAttribution:{mode:"diarization" as const,maxSpeakers:4 as const,deviceProfile:deviceSpeakerProfile.id,allowVoiceIdentity:false}};
  const originals:TranscriptResult[]=[
    {segmentId:"first",revision:1,isFinal:true,text:"我们要测试 Qwen Three ASR。",language:"zh",timing:{startMs:632,endMs:3200,source:"estimated"}},
    {segmentId:"second",revision:1,isFinal:true,text:"Hy-MT2 和 VoxCPM2 的在线模型链路。",language:"zh",timing:{startMs:3200,endMs:7328,source:"estimated"}},
  ].map(t=>({...t,...(sourceLanguage==="auto"?{automaticLanguageStatus:"detected" as const}:{})}));
  let calls=0,sequence=0,cursor=0;
  const base={createSession:vi.fn(async()=>{}),closeSession:vi.fn(async()=>{}),healthCheck:async()=>true,
    transcribe:vi.fn(async()=>structuredClone(originals[calls++-2]??null)),flush:async()=>null,commitBoundary:vi.fn(async()=>null)};
  const device=new DeviceSpeakerAttributionProvider("object",16000);
  const asr=new SpeakerAwareAsrProvider(base,device,undefined,undefined,{enabled:false,maxSessions:0,maxDurationMs:0,maxRecords:0});
  const translate=vi.fn(async(input:{text:string})=>input.text.includes("、")
    ?"We will test the online model pipeline with Qwen Three ASR, Hy-MT2 and VoxCPM2.":"We will test Qwen Three ASR.");
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"configured-mt",timeoutMs:1000,
    publicSession:session,asrProvider:asr,translationClient:{translate,supportsAttemptContext:true,healthCheck:async()=>true}});
  async function feed(endMs:number,spans:Array<[number,number,number]>) {
    const end=endMs*16;
    expect(device.accept({type:"speaker.evidence",sessionId:"object",profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
      sequence:++sequence,sampleRate:16000,throughSample:end,spans:spans.map(([speaker,start,stop])=>({speaker,startSample:start*16,endSample:stop*16,confidence:0.97,overlap:false}))},end)).toBe(true);
    const frame:AudioFrame={type:"audio.frame",sessionId:"object",sequence,timestampMs:endMs,format:"pcm16",sampleRate:16000,data:Buffer.alloc((end-cursor)*2).toString("base64")};
    markAcceptedAudioRange(frame,{startSample:cursor,endSample:end});cursor=end;
    return consume(provider.sendAudio(frame));
  }
  async function first(){await provider.createSession(session);await feed(480,[[0,0,480]]);await feed(1040,[[0,480,720],[1,720,1040]]);return feed(3200,[[1,1040,3200]]);}
  return{provider,session,base,translate,first,next:()=>feed(7328,[[1,3200,7328]])};
}
afterEach(()=>vi.restoreAllMocks());

describe("phone speaker metadata -> public assembler -> MT/TTS revision",()=>{
  it.each(["auto","zh"] as const)("closes the same real modules and wire contract with source=%s",async source=>{
    const now=vi.spyOn(Date,"now").mockReturnValue(10000),f=fixture(false,source);
    try{
      const first=await f.first();now.mockReturnValue(14000);const second=await f.next();
      const wire=JSON.parse(readFileSync(new URL("../../../../../packages/contracts/fixtures/public-object-continuation-v1.json",import.meta.url),"utf8"));
      const fields=["type","sessionId","segmentId","turnId","revision","text","language","speaker","timing","dominantLanguage","detectedLanguages","mixedLanguage"];
      expect([...first,...second].map(e=>Object.fromEntries(Object.entries(e).filter(([k,v])=>fields.includes(k)&&v!==undefined)))).toEqual(wire.events);
      expect(f.translate.mock.calls).toHaveLength(2);expect(f.base.createSession).toHaveBeenCalledTimes(1);
      expect(f.base.commitBoundary).not.toHaveBeenCalled(); // Phone speaker evidence never commits public ASR.
      expect(await consume(f.provider.flushSession("object",{finishSession:true}))).toEqual([]);
    }finally{await f.provider.closeSession("object");}
  });
  it("cancels stale reading on the actual merged revision, preserving an unrelated queued caption",async()=>{
    const now=vi.spyOn(Date,"now").mockReturnValue(10000),f=fixture(true),entered=deferred(),release=deferred();
    const sent:ServerRealtimeEvent[]=[],syntheses:Array<[string,number|undefined]>=[];
    const queue=new RealtimeTtsOutputQueue({sessionId:"object",voiceOutput:true,isSessionActive:()=>true,
      synthesizer:{enabled:true,cancelSession:vi.fn(),closeSession:vi.fn(),async *synthesizeStream(e){
        syntheses.push([e.segmentId,e.revision]);if(e.segmentId==="first"&&e.revision===1){entered.resolve();await release.promise;}
        yield{type:"audio.output",sessionId:"object",segmentId:e.segmentId,revision:e.revision,sequence:1,format:"pcm16",sampleRate:16000,data:"AAA=",isFinal:true};
      }}});
    try{
      for(const e of await f.first())queue.enqueue(e,e=>sent.push(e));await entered.promise;
      queue.enqueue({type:"translation.final",sessionId:"object",segmentId:"unrelated",revision:1,text:"Okay.",language:"en"},e=>sent.push(e));
      now.mockReturnValue(14000);for(const e of await f.next())queue.enqueue(e,e=>sent.push(e));
      release.resolve();await queue.drain();await queue.drainInFlight();
      expect(sent.map(e=>"segmentId" in e?[e.segmentId,e.revision]:null)).toEqual([["first",2],["unrelated",1]]);
      expect(syntheses).toEqual([["first",1],["first",2],["unrelated",1]]);
    }finally{release.resolve();queue.close();await queue.drainInFlight();await f.provider.closeSession("object");}
  });
});
