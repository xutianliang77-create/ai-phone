import {describe,expect,it,vi} from "vitest";
import type {TranscriptResult} from "../../asr/asr-provider.js";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";
import {SegmentAssembler} from "../../segments/segment-assembler.js";

const session={sessionId:"short-session",sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false};
const source=(id:string,text:string,speakerId="same",language="zh" as const):TranscriptResult=>({
  segmentId:id,revision:1,isFinal:true,text,language,endpointReason:"silence",
  timing:{startMs:id==="first"?0:1848,endMs:id==="first"?1440:4000,source:"estimated"},
  speaker:{speakerId,role:"speaker",source:"diarization"},
});
const frame=(sequence:number)=>({type:"audio.frame" as const,sessionId:session.sessionId,
  sequence,timestampMs:sequence,format:"pcm16" as const,sampleRate:16000,data:"AAA="});

async function run(publicMode:boolean){
  let index=0;const translate=vi.fn(async()=>"one translation");
  const chunks=[source("first","对。"),source("second","但这条视频很快就有了结果。")];
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"synthetic",timeoutMs:100,
    ...(publicMode?{publicSession:session}:{}),translationClient:{translate,healthCheck:async()=>true},
    asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,
      transcribe:async()=>chunks[index++]??null,flush:async()=>null}});
  await provider.createSession(session);const events=[];
  const clock=vi.spyOn(Date,"now");
  try{
    clock.mockReturnValue(1000);for await(const e of provider.sendAudio(frame(1)))events.push(e);
    clock.mockReturnValue(3600);for await(const e of provider.sendAudio(frame(2)))events.push(e);
    for await(const e of provider.flushSession(session.sessionId,{finishSession:true}))events.push(e);
    return{events,translationCalls:translate.mock.calls.length};
  }finally{clock.mockRestore();await provider.closeSession(session.sessionId);}
}

describe("public short continuation in the original provider",()=>{
  it("keeps adjacent same-speaker short final and longer continuation in one translation",async()=>{
    const result=await run(true);
    expect(result.translationCalls).toBe(1);
    expect(result.events.filter(e=>e.type==="translation.final")).toHaveLength(1);
  });
  it("retains the frozen private immediate buffer behavior",async()=>{
    const result=await run(false);
    expect(result.translationCalls).toBe(2);
  });
  it("still releases a real short reply and never merges different speakers or languages",()=>{
    const a=new SegmentAssembler({maxBufferMs:3000});
    expect(a.push("a",source("first","对。"),0).ready).toEqual([]);
    expect(a.drainExpired("a",2999)).toEqual([]);
    expect(a.drainExpired("a",3000)[0].text).toBe("对。");
    const b=new SegmentAssembler({maxBufferMs:3000});b.push("b",source("first","对。","first"),0);
    expect(b.push("b",source("second","另一位说话。","second"),2600).ready.map(x=>x.segmentId)).toEqual(["first","second"]);
    const c=new SegmentAssembler({maxBufferMs:3000});
    const first=c.push("c",{...source("first","Okay.","same","en"),automaticLanguageStatus:"detected"},0);
    const second=c.push("c",{...source("second","继续中文。"),automaticLanguageStatus:"detected"},2600);
    expect([...first.ready,...second.ready].map(x=>x.language)).toEqual(["en","zh"]);
  });
});
