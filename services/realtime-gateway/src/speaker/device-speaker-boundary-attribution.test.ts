import {describe,expect,it} from "vitest";
import type {TranscriptResult} from "../asr/asr-provider.js";
import type {SpeakerSpan} from "./speaker-attribution-provider.js";
import {attributeSpeakerTranscripts,type SpeakerBoundaryGuard} from "./speaker-transcript-attribution.js";

const raw=():TranscriptResult=>({segmentId:"first",revision:1,turnId:"turn",text:"我们要测试 Qwen Three ASR。",language:"zh",
  timing:{startMs:48632,endMs:51200,source:"estimated"}});
const boundary=(at=48720):SpeakerBoundaryGuard=>({boundaryMs:at,previousSpeakerId:"old",nextSpeakerId:"new"});
const spans=(at=48720):SpeakerSpan[]=>[
  {speakerId:"old",startMs:48632,endMs:at,confidence:0.95,overlap:false},
  {speakerId:"new",startMs:at,endMs:51200,confidence:0.97,overlap:false},
];
const resolve=(value=raw(),evidence=spans(),edges=[boundary()],confirmed=(_id:string)=>true)=>
  attributeSpeakerTranscripts([value],evidence,()=>undefined,edges,confirmed,{deviceBoundaryPolicy:true})[0];

describe("phone evidence uses sequential boundaries without inventing simultaneous speech",()=>{
  it.each([48,88,159])("uses sufficient direct edge evidence at %sms without changing timestamps",offset=>{
    const at=48632+offset,result=resolve(raw(),spans(at),[boundary(at)]);
    expect(result.speaker).toMatchObject({speakerId:"new",source:"diarization"});
    expect(result.timing).toMatchObject({startMs:48632,endMs:51200});
    expect(result.timing?.overlap).not.toBe(true);
  });
  it("also protects the end edge using the same evidence threshold",()=>{
    const at=51120,result=resolve(raw(),spans(at),[boundary(at)]);
    expect(result.speaker?.speakerId).toBe("old");expect(result.timing?.overlap).not.toBe(true);
  });
  it.each([160,600,1200])("keeps a meaningful sequential switch unknown at %sms, not overlapping",offset=>{
    const at=48632+offset,result=resolve(raw(),spans(at),[boundary(at)]);
    expect(result.speaker?.speakerId).toBe("unknown");expect(result.timing?.overlap).not.toBe(true);
    expect(result.timing?.activeSpeakerIds??[]).toEqual([]);
  });
  it("keeps actual simultaneous spans and explicit overlap protected",()=>{
    const evidence=spans();evidence[0].endMs=48800;
    expect(resolve(raw(),evidence)).toMatchObject({speaker:{speakerId:"unknown"},timing:{overlap:true}});
    expect(resolve({...raw(),timing:{...raw().timing!,overlap:true}})).toMatchObject({speaker:{speakerId:"unknown"},timing:{overlap:true}});
    const marked=spans();marked[1].overlap=true;
    expect(resolve(raw(),marked)).toMatchObject({speaker:{speakerId:"unknown"},timing:{overlap:true}});
  });
  it("does not infer a speaker without sufficient direct, confirmed, contiguous evidence",()=>{
    for(const evidence of [[],[{...spans()[1],endMs:48800}],
      [{...spans()[1],endMs:49300},{...spans()[1],startMs:50000}]]){
      expect(resolve(raw(),evidence).speaker?.speakerId).toBe("unknown");
    }
    expect(resolve(raw(),spans(),[boundary()],id=>id!=="new").speaker?.speakerId).toBe("unknown");
    expect(resolve(raw(),spans().map(s=>({...s,confidence:0.4}))).speaker?.speakerId).toBe("unknown");
    expect(resolve(raw(),spans(),[boundary(),boundary(48800)]).speaker?.speakerId).toBe("unknown");
  });
  it("does not erase timed words, precise timing or an explicit different speaker",()=>{
    expect(resolve({...raw(),tokenTimings:[{text:"嗯",startMs:48632,endMs:48700}]}).speaker?.speakerId).toBe("unknown");
    expect(resolve({...raw(),timing:{...raw().timing!,source:"client"}}).speaker?.speakerId).toBe("unknown");
    expect(resolve({...raw(),speaker:{speakerId:"old",role:"speaker",source:"diarization"}}).speaker?.speakerId).toBe("unknown");
  });
  it("preserves the original private/default attribution behavior",()=>{
    expect(attributeSpeakerTranscripts([raw()],spans(),()=>undefined,[boundary()],()=>true)[0])
      .toMatchObject({speaker:{speakerId:"unknown"},timing:{overlap:true,activeSpeakerIds:["old","new"]}});
  });
});
