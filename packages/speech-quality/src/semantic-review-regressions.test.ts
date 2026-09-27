import {describe,expect,it} from "vitest";
import {SegmentAssembler} from "./segment-assembler.js";
import type {SpeechTranscript} from "./speech-transcript.js";

const create=()=>new SegmentAssembler({emitSemanticContinuationRevisions:true,maxBufferMs:3000});
function part(id:string,text:string,startMs:number,endMs:number,revision=1):SpeechTranscript {
  return {segmentId:id,text,revision,language:"zh",automaticLanguageStatus:"detected",turnId:"turn",
    speaker:{speakerId:"speaker-1",role:"speaker",source:"diarization"},timing:{startMs,endMs,source:"estimated"}};
}
const fragments=()=>[
  part("first","我们需要 Alpha1。",0,1000),
  part("second","Beta2 和 Gamma3。",1000,2000),
  part("third","Delta4 和 Epsilon5。",2000,3000),
];

describe("7d69265 review regressions",()=>{
  it.each(["缓存和数据库正常。","缓存和数据库稳定。","缓存和数据库恢复。","缓存和数据库的状态正常。"])
    ("does not infer a nominal list from absence of known predicate words: %s",text=>{
      const a=create();a.push("s",part("first","我们需要检查日志。",0,1000),0);
      const result=a.push("s",part("second",text,1000,2000),1000);
      expect(result.ready.map(x=>x.segmentId)).toEqual(["second"]);
      expect(result.ready[0].text).toBe(text);expect(result.supersededSegmentIds).toBeUndefined();
    });

  it("does not promote unclassified ordinary word strings to verified noun phrases",()=>{
    const a=create();a.push("s",part("first","我们需要苹果。",0,1000),0);
    const result=a.push("s",part("second","香蕉和梨。",1000,2000),1000);
    expect(result.ready[0].segmentId).toBe("second");
    expect(result.supersededSegmentIds).toBeUndefined();
  });

  it.each([0,1,2])("retains accumulated object context when correcting constituent %s of three",index=>{
    const a=create(),p=fragments();
    a.push("s",p[0],0);a.push("s",p[1],1200);
    expect(a.push("s",p[2],2400).ready[0]).toMatchObject({segmentId:"first",revision:3,
      text:"我们需要 Alpha1、Beta2 和 Gamma3、Delta4 和 Epsilon5。"});
    const texts=["我们需要 Alpha6。","Beta2 和 Gamma6。","Delta4 和 Epsilon6。"];
    const correction={...p[index],revision:4,text:texts[index]};
    const result=a.push("s",correction,3000);
    expect(result.ready).toHaveLength(1);
    expect(result.ready[0]).toMatchObject({segmentId:"first",revision:4,
      text:[index===0?"我们需要 Alpha6":"我们需要 Alpha1",index===1?"Beta2 和 Gamma6":"Beta2 和 Gamma3",index===2?"Delta4 和 Epsilon6。":"Delta4 和 Epsilon5。"].join("、")});
    expect(result.supersededSegmentIds).toEqual(["second","third"]);
    expect(a.push("s",correction,3100).ready).toEqual([]);
  });

  it.each(["speaker","predicate"])("still restores separate text for a genuinely invalidated %s grouping",kind=>{
    const a=create(),p=fragments();a.push("s",p[0],0);a.push("s",p[1],1200);a.push("s",p[2],2400);
    const result=a.push("s",{...p[1],revision:4,...(kind==="speaker"
      ?{speaker:{speakerId:"other",role:"speaker" as const,source:"diarization" as const}}
      :{text:"缓存和数据库正常。"})},3000);
    expect(result.ready.map(x=>x.segmentId)).toEqual(["first","second","third"]);
    expect(result.ready.every(x=>x.revision===4)).toBe(true);
  });
});
