import {describe,expect,it} from "vitest";
import {SegmentAssembler} from "./segment-assembler.js";
import type {SpeechTranscript} from "./speech-transcript.js";

function part(id:string,text:string,startMs:number,endMs:number,change:Partial<SpeechTranscript>={}):SpeechTranscript {
  return {segmentId:id,revision:1,turnId:"turn_3",text,language:"zh",automaticLanguageStatus:"detected",
    speaker:{speakerId:"device-speaker-1",role:"speaker",source:"diarization"},
    timing:{startMs,endMs,source:"estimated"},...change};
}
const first=()=>part("first","会议结束以后，我会整理会议纪要。",17824,20992);
const second=()=>part("second","并在下班前发给大家确认。",20992,24128);
const create=()=>new SegmentAssembler({emitSemanticContinuationRevisions:true,maxBufferMs:3000});

describe("bounded semantic continuation of cloud finals",()=>{
  it("keeps first output immediate, then revises one id for the observed continuous clause",()=>{
    const a=create();
    expect(a.push("s",first(),0).ready).toEqual([first()]);
    const result=a.push("s",second(),3500);
    expect(result.ready).toHaveLength(1);
    expect(result.ready[0]).toMatchObject({segmentId:"first",revision:2,
      text:"会议结束以后，我会整理会议纪要，并在下班前发给大家确认。",
      timing:{startMs:17824,endMs:24128},speaker:{speakerId:"device-speaker-1"}});
    expect(result.ready[0].endpointReason).toBeUndefined(); // Never invent max_duration.
    expect(result.supersededSegmentIds).toEqual(["second"]);
    expect(a.flush("s",3600)).toEqual([]);
    expect(a.push("s",second(),3700).ready).toEqual([]);
  });

  it("uses language-aware joining without a provider/model-specific switch",()=>{
    const a=create();
    a.push("s",part("one","I will check the contract.",0,1400,{language:"en"}),0);
    expect(a.push("s",part("two","and send it today.",1450,2600,{language:"en"}),2000).ready[0])
      .toMatchObject({segmentId:"one",text:"I will check the contract, and send it today.",revision:2});
  });

  it.each([
    ["speaker",{speaker:{speakerId:"other",role:"speaker",source:"diarization"}}],
    ["unknown speaker",{speaker:{speakerId:"unknown",role:"unknown",source:"unknown"}}],
    ["turn",{turnId:"other"}],
    ["missing turn",{turnId:undefined}],
    ["missing speaker",{speaker:undefined}],
    ["language",{language:"en"}],
    ["uncertain language",{automaticLanguageStatus:"unknown"}],
    ["overlap",{timing:{startMs:20992,endMs:24128,source:"estimated",overlap:true}}],
    ["gap",{timing:{startMs:22000,endMs:24128,source:"estimated"}}],
    ["missing timing",{timing:undefined}],
    ["multiple speakers",{timing:{startMs:20992,endMs:24128,source:"estimated",activeSpeakerIds:["device-speaker-1","other"]}}],
  ] as Array<[string,Partial<SpeechTranscript>]>)("retains the original boundary for %s",(_label,change)=>{
    const a=create();a.push("s",first(),0);
    const result=a.push("s",{...second(),...change},1000);
    expect(result.ready[0]?.segmentId).toBe("second");expect(result.supersededSegmentIds).toBeUndefined();
  });

  it("does not append an unrelated sentence, a question or a real short answer",()=>{
    for(const text of ["今天我们开始另一个话题。","并且为什么？","Okay."]){
      const a=create();a.push("s",first(),0);
      expect(a.push("s",{...second(),text},1000).ready[0].segmentId).toBe("second");
    }
    const a=create();a.push("s",part("short","Okay.",0,300,{language:"en"}),0);
    expect(a.push("s",part("and","and start the meeting.",300,1000,{language:"en"}),1000).ready[0].segmentId).toBe("and");
  });

  it("does not change the private/default assembler or fake a hard-cut reason",()=>{
    const a=new SegmentAssembler();a.push("s",first(),0);
    expect(a.push("s",second(),1000).ready[0].segmentId).toBe("second");
    const b=new SegmentAssembler({emitMaxDurationRevisions:true});b.push("s",first(),0);
    expect(b.push("s",second(),1000).ready[0].segmentId).toBe("second");
  });

  it("expires from the first emission and clears at flush, close and session boundaries",()=>{
    const a=create();a.push("s",first(),0);expect(a.push("s",second(),5001).ready[0].segmentId).toBe("second");
    for(const clear of [(x:SegmentAssembler)=>x.flush("s",500),(x:SegmentAssembler)=>x.clear("s")]){
      const b=create();b.push("s",first(),0);clear(b);
      expect(b.push("s",second(),1000).ready[0].segmentId).toBe("second");
    }
    const c=create();c.push("s",first(),0);expect(c.push("other",second(),1000).ready[0].segmentId).toBe("second");
  });

  it("preserves an earlier buffered prefix and limits chaining to the inherited three parts",()=>{
    const a=create();
    expect(a.push("s",part("prefix","我会把我们。",0,500),0).partial).toBeDefined();
    expect(a.push("s",part("verb","送到会场。",500,1000),200).ready[0].text).toBe("我会把我们送到会场。");
    const result=a.push("s",part("next","并带上资料。",1000,1500),1000);
    expect(result.ready[0]).toMatchObject({segmentId:"prefix",text:"我会把我们送到会场，并带上资料。"});
    const b=create();b.push("s",first(),0);b.push("s",second(),2000);
    const third=b.push("s",part("third","并安排复核。",24128,25000),3500);
    expect(third.ready[0].segmentId).toBe("first");
    expect(b.push("s",part("fourth","并通知其他人。",25000,26000),4000).ready[0].segmentId).toBe("fourth");
  });

  it("keeps every absorbed clause when a newer source revision corrects either constituent",()=>{
    for(const which of ["first","second"]){
      const a=create();a.push("s",first(),0);a.push("s",second(),1000);
      const correction=which==="first"?{...first(),revision:3,text:"会议结束以后，我会校对会议纪要。"}:
        {...second(),revision:3,text:"并在下班前发给负责人确认。"};
      const result=a.push("s",correction,1200);
      expect(result.ready[0].segmentId).toBe("first");expect(result.ready[0].revision).toBeGreaterThan(2);
      expect(result.ready[0].text).toContain(which==="first"?"校对会议纪要，并在下班前":"整理会议纪要，并在下班前发给负责人");
      expect(a.push("s",correction,1300).ready).toEqual([]);
    }
  });

  it("restores separate higher-revision text when a correction invalidates the known-speaker grouping",()=>{
    const a=create();a.push("s",first(),0);a.push("s",second(),1000);
    const corrected={...second(),revision:3,speaker:{speakerId:"other",role:"speaker",source:"diarization"} as const};
    const result=a.push("s",corrected,1200);
    expect(result.ready.map(x=>x.segmentId)).toEqual(["first","second"]);
    expect(result.ready.map(x=>x.text)).toEqual([first().text,second().text]);
    expect(result.ready.every(x=>x.revision!>2)).toBe(true);
    expect(result.supersededSegmentIds).toBeUndefined();
  });

  it("does not extend the time window by appending and respects the character limit",()=>{
    const a=create();a.push("s",first(),0);a.push("s",second(),4900);
    expect(a.push("s",part("late","并安排复核。",24128,25000),5001).ready[0].segmentId).toBe("late");
    const b=new SegmentAssembler({emitSemanticContinuationRevisions:true,maxBufferedCharacters:30});
    b.push("s",first(),0);
    const long=part("long","并在下班前发给所有相关负责人逐一检查并最终签字确认。",20992,26000);
    expect(b.push("s",long,1000).ready[0].segmentId).toBe("long");
  });

  it("retains word timing or drops unaligned punctuation timing rather than inventing it",()=>{
    const left=part("one","I will check the contract.",0,1400,{language:"en",
      tokenTimings:[{text:"contract",characterStart:17,characterEnd:25,startMs:900,endMs:1300}]});
    // Use exact character offsets from the recognized surface, not guessed timing.
    const at=left.text.indexOf("contract");left.tokenTimings![0].characterStart=at;left.tokenTimings![0].characterEnd=at+8;
    const right=part("two","and send it today.",1450,2600,{language:"en",tokenTimings:[]});
    const a=create();a.push("s",left,0);
    const merged=a.push("s",right,1000).ready[0];
    expect(merged.tokenTimings).toEqual(left.tokenTimings);
    const b=create();const punctuation={text:".",characterStart:left.text.length-1,characterEnd:left.text.length,startMs:1300,endMs:1400};
    b.push("s",{...left,tokenTimings:[...left.tokenTimings!,punctuation]},0);
    expect(b.push("s",right,1000).ready[0].tokenTimings).toBeUndefined();
  });
});
