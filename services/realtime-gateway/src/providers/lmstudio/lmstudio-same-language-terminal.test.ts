import {it,expect,vi} from "vitest";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";
import {RealtimeFlushTracker} from "../../connection/realtime-flush-tracker.js";
import type {ServerRealtimeEvent} from "@translation/contracts";
it("terminates same-target automatic turns without MT or fabricated translated text",async()=>{
  const session={sessionId:"same-language",sourceLanguage:"auto" as const,targetLanguage:"en" as const,voiceOutput:false};
  const translate=vi.fn(async()=>"unexpected");
  const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"synthetic",timeoutMs:500,publicSession:session,
    asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,flush:async()=>null,
      transcribe:async()=>({segmentId:"s",revision:1,isFinal:true,text:"This is already English.",language:"en" as const,
        automaticLanguageStatus:"detected" as const,timing:{startMs:0,endMs:1500,source:"estimated" as const}})},
    translationClient:{supportsAttemptContext:true,healthCheck:async()=>true,translate}});
  const tracker=new RealtimeFlushTracker(),events:ServerRealtimeEvent[]=[];
  await provider.createSession(session);
  try{
    for await(const e of provider.sendAudio({type:"audio.frame",sessionId:session.sessionId,sequence:0,timestampMs:0,sampleRate:16000,format:"pcm16",data:"AAA="})){events.push(e);tracker.record(e);}
    tracker.beginFinalization();for await(const e of provider.flushSession(session.sessionId,{finishSession:true}))tracker.record(e);
    expect(events.map(e=>e.type)).toEqual(["transcript.final","translation.skipped"]);
    expect(translate).not.toHaveBeenCalled();
    expect(tracker.summarize({audioFlushed:true,providerFlushed:true})).toMatchObject({unresolvedSegmentCount:0,translationFailedCount:0});
  }finally{await provider.closeSession(session.sessionId);}
});
