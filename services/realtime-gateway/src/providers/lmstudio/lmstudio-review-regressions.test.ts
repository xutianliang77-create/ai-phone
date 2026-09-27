import {afterEach,describe,expect,it,vi} from "vitest";
import type {ServerRealtimeEvent} from "@translation/contracts";
import type {TranscriptResult} from "../../asr/asr-provider.js";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";

function part(id:string,text:string,startMs:number,endMs:number,revision=1):TranscriptResult {
  return {segmentId:id,text,revision,isFinal:true,language:"zh",automaticLanguageStatus:"detected",turnId:"turn",
    speaker:{speakerId:"same",role:"speaker",source:"diarization"},timing:{startMs,endMs,source:"estimated"}};
}
function fixture(input:TranscriptResult[]) {
  const session={sessionId:"review",sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false};
  const translate=vi.fn(async(args:{text:string;attemptContext?:{segmentId:string;revision:number}})=>`translated:${args.text}`);
  let index=0;
  const asr={createSession:vi.fn(async()=>{}),closeSession:vi.fn(async()=>{}),healthCheck:async()=>true,
    transcribe:async()=>input[index++]??null,flush:async()=>null};
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"synthetic",timeoutMs:1000,
    publicSession:session,asrProvider:asr,translationClient:{translate,supportsAttemptContext:true,healthCheck:async()=>true}});
  async function next(){const result:ServerRealtimeEvent[]=[];
    for await(const e of provider.sendAudio({type:"audio.frame",sessionId:session.sessionId,sequence:index+1,
      timestampMs:Date.now(),format:"pcm16",sampleRate:16000,data:"AAA="}))result.push(e);return result;}
  return{provider,session,translate,asr,next};
}
afterEach(()=>vi.restoreAllMocks());

describe("review fixes through the original public Provider",()=>{
  it("keeps independent statements intact without issuing a merged MT request or tombstone",async()=>{
    const now=vi.spyOn(Date,"now").mockReturnValue(10000);
    const text=["我们需要检查日志。","缓存和数据库正常。"];
    const f=fixture([part("first",text[0],0,1000),part("second",text[1],1000,2000)]);
    await f.provider.createSession(f.session);
    try{
      await f.next();now.mockReturnValue(11000);const events=await f.next();
      expect(events.filter(e=>e.type==="transcript.final")).toEqual([expect.objectContaining({segmentId:"second",revision:1,text:text[1]})]);
      expect(f.translate.mock.calls.map(([a])=>a.text)).toEqual(text);
    }finally{await f.provider.closeSession(f.session.sessionId);}
  });

  it("makes just one corrected MT revision after a valid three-part enumeration",async()=>{
    const now=vi.spyOn(Date,"now").mockReturnValue(10000);
    const f=fixture([part("first","我们需要 Alpha1。",0,1000),part("second","Beta2 和 Gamma3。",1000,2000),
      part("third","Delta4 和 Epsilon5。",2000,3000),part("second","Beta2 和 Gamma6。",1000,2000,4)]);
    await f.provider.createSession(f.session);
    try{
      await f.next();now.mockReturnValue(11200);await f.next();now.mockReturnValue(12400);await f.next();
      now.mockReturnValue(13000);const events=await f.next();
      const textFinals=events.filter(e=>e.type==="transcript.final"&&e.text!=="");
      expect(textFinals).toEqual([expect.objectContaining({segmentId:"first",revision:4,text:"我们需要 Alpha1、Beta2 和 Gamma6、Delta4 和 Epsilon5。"})]);
      expect(events.filter(e=>e.type==="transcript.final"&&e.text==="").map(e=>e.segmentId)).toEqual(["second","third"]);
      expect(events.filter(e=>e.type==="translation.final")).toHaveLength(1);
      expect(f.translate.mock.calls.map(([a])=>a.attemptContext)).toEqual([1,2,3,4].map(revision=>({segmentId:"first",revision})));
      expect(f.asr.createSession).toHaveBeenCalledTimes(1);
    }finally{await f.provider.closeSession(f.session.sessionId);}
  });
});
