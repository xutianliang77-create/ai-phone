import {afterEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import type {ServerRealtimeEvent} from "@translation/contracts";
import type {TranscriptResult} from "../../asr/asr-provider.js";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";
import {RealtimeTtsOutputQueue} from "../../tts/realtime-tts-output.js";

const transcripts:TranscriptResult[]=[
  {segmentId:"first",revision:1,turnId:"turn_3",text:"会议结束以后，我会整理会议纪要。",language:"zh",isFinal:true,
    automaticLanguageStatus:"detected",speaker:{speakerId:"device-speaker-1",source:"diarization",role:"speaker"},
    timing:{startMs:17824,endMs:20992,source:"estimated"}},
  {segmentId:"second",revision:1,turnId:"turn_3",text:"并在下班前发给大家确认。",language:"zh",isFinal:true,
    automaticLanguageStatus:"detected",speaker:{speakerId:"device-speaker-1",source:"diarization",role:"speaker"},
    timing:{startMs:20992,endMs:24128,source:"estimated"}},
];
const frame=(sequence:number)=>({type:"audio.frame" as const,sessionId:"semantic",sequence,timestampMs:sequence,
  format:"pcm16" as const,sampleRate:16000,data:"AAA="});
const consume=async(events:AsyncGenerator<ServerRealtimeEvent>)=>{const result=[];for await(const event of events)result.push(event);return result;};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{resolve,promise};};
function fixture(publicMode=true,voiceOutput=false){
  let index=0;
  const translate=vi.fn(async(input:{text:string})=>input.text.includes("，并")?"I will prepare the minutes and send them before work ends.":"I will prepare the minutes.");
  const session={sessionId:"semantic",sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput};
  const asr={createSession:vi.fn(async()=>{}),closeSession:vi.fn(async()=>{}),healthCheck:async()=>true,
    transcribe:vi.fn(async()=>structuredClone(transcripts[index++]??null)),flush:async()=>null};
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"configured-model",timeoutMs:100,
    ...(publicMode?{publicSession:session}:{}),asrProvider:asr,
    translationClient:{supportsAttemptContext:true,translate,healthCheck:async()=>true}});
  return{provider,session,translate,asr};
}
afterEach(()=>vi.useRealTimers());

describe("public conversation cloud-final semantic revision on the original provider",()=>{
  it.each([false,true])("reuses one ASR and the same logical segment with voiceOutput=%s",async voice=>{
    vi.useFakeTimers();vi.setSystemTime(10000);
    const f=fixture(true,voice);await f.provider.createSession(f.session);
    try{
      const first=await consume(f.provider.sendAudio(frame(1)));
      expect(first.map(e=>e.type)).toEqual(["transcript.final","translation.final"]);
      expect(first[0]).toMatchObject({segmentId:"first",revision:1,text:transcripts[0].text});
      vi.setSystemTime(13500);
      const second=await consume(f.provider.sendAudio(frame(2)));
      expect(second.map(e=>e.type)).toEqual(["transcript.final","transcript.final","translation.final"]);
      expect(second[0]).toMatchObject({segmentId:"second",text:"",revision:2});
      expect(second[1]).toMatchObject({segmentId:"first",revision:2,text:"会议结束以后，我会整理会议纪要，并在下班前发给大家确认。"});
      expect(second[2]).toMatchObject({segmentId:"first",revision:2,language:"en"});
      const fixture=JSON.parse(readFileSync(new URL("../../../../../packages/contracts/fixtures/public-semantic-continuation-v1.json",import.meta.url),"utf8"));
      const fields=["type","sessionId","segmentId","turnId","revision","text","language","speaker","timing"];
      expect([...first,...second].map(event=>Object.fromEntries(Object.entries(event).filter(([key,value])=>fields.includes(key)&&value!==undefined))))
        .toEqual(fixture.events);
      expect(f.translate.mock.calls.map(([input])=>input)).toMatchObject([
        {text:transcripts[0].text,sourceLanguage:"zh",targetLanguage:"en",attemptContext:{segmentId:"first",revision:1}},
        {text:"会议结束以后，我会整理会议纪要，并在下班前发给大家确认。",attemptContext:{segmentId:"first",revision:2}},
      ]);
      expect(await consume(f.provider.flushSession("semantic",{finishSession:true}))).toEqual([]);
      expect(f.translate).toHaveBeenCalledTimes(2);expect(f.asr.createSession).toHaveBeenCalledTimes(1);
    }finally{await f.provider.closeSession("semantic");}
  });

  it("keeps the frozen private conversation's separate-final behavior",async()=>{
    const f=fixture(false);await f.provider.createSession(f.session);
    try{await consume(f.provider.sendAudio(frame(1)));const events=await consume(f.provider.sendAudio(frame(2)));
      expect(events.find(e=>e.type==="translation.final")).toMatchObject({segmentId:"second",revision:1});
    }finally{await f.provider.closeSession("semantic");}
  });

  it("preserves a successful first translation but marks a failed merged revision without blind retry",async()=>{
    const f=fixture();f.translate.mockImplementation(async input=>{if(input.text.includes("，并"))throw Error("synthetic merged failure");return "Initial translation.";});
    await f.provider.createSession(f.session);
    try{await consume(f.provider.sendAudio(frame(1)));const events=await consume(f.provider.sendAudio(frame(2)));
      expect(events.find(e=>e.type==="translation.failed")).toMatchObject({segmentId:"first",revision:2});
      expect(events.some(e=>e.type==="translation.final")).toBe(false);
      expect(await consume(f.provider.flushSession("semantic",{finishSession:true}))).toEqual([]);
      expect(f.translate).toHaveBeenCalledTimes(2);
    }finally{await f.provider.closeSession("semantic");}
  });

  it("uses the inherited TTS generation replacement without dropping unrelated queued speech",async()=>{
    const f=fixture(true,true),entered=deferred(),release=deferred();
    const syntheses:Array<[string,number|undefined]>=[],sent:ServerRealtimeEvent[]=[];
    const queue=new RealtimeTtsOutputQueue({sessionId:"semantic",voiceOutput:true,isSessionActive:()=>true,
      synthesizer:{enabled:true,cancelSession:vi.fn(),closeSession:vi.fn(),async *synthesizeStream(event){
        syntheses.push([event.segmentId,event.revision]);
        if(event.segmentId==="first"&&event.revision===1){entered.resolve();await release.promise;}
        yield {type:"audio.output",sessionId:"semantic",segmentId:event.segmentId,revision:event.revision,sequence:1,
          format:"pcm16",sampleRate:16000,data:"AAA=",isFinal:true};
      }}});
    await f.provider.createSession(f.session);
    try{
      for(const event of await consume(f.provider.sendAudio(frame(1))))queue.enqueue(event,e=>sent.push(e));
      await entered.promise;
      queue.enqueue({type:"translation.final",sessionId:"semantic",segmentId:"unrelated",revision:1,text:"Another sentence.",language:"en"},e=>sent.push(e));
      const revised=await consume(f.provider.sendAudio(frame(2)));
      for(const event of revised)queue.enqueue(event,e=>sent.push(e));
      release.resolve();await queue.drain();await queue.drainInFlight();
      expect(sent.map(e=>"segmentId" in e?[e.segmentId,e.revision]:null)).toEqual([["first",2],["unrelated",1]]);
      for(const event of revised)queue.enqueue(event,e=>sent.push(e));await queue.drain();
      expect(syntheses).toEqual([["first",1],["first",2],["unrelated",1]]);
    }finally{release.resolve();queue.close();await queue.drainInFlight();await f.provider.closeSession("semantic");}
  });
});
