import {describe,expect,it} from "vitest";
import {SegmentAssembler} from "./segment-assembler.js";
import type {SpeechTranscript} from "./speech-transcript.js";

const short=(segmentId:string,patch:Partial<SpeechTranscript>={}):SpeechTranscript=>({segmentId,text:"Okay.",language:"en",revision:1,...patch});
const range=(startMs:number,endMs:number)=>({startMs,endMs,source:"estimated" as const});
describe("short final repetition uses speech context, not just text and arrival time",()=>{
  it("preserves equal short answers in disjoint audio ranges inside the old duplicate window",()=>{
    const a=new SegmentAssembler();
    expect(a.push("s",short("first",{timing:range(0,300)}),100).ready).toHaveLength(1);
    expect(a.push("s",short("second",{timing:range(450,700)}),500).ready).toMatchObject([{segmentId:"second",text:"Okay."}]);
  });
  it("does not collapse back-to-back ranges that merely share an endpoint",()=>{
    const a=new SegmentAssembler();a.push("s",short("first",{timing:range(0,300)}),100);
    expect(a.push("s",short("second",{timing:range(300,600)}),200).ready).toHaveLength(1);
  });
  it("still suppresses the same content over the same audio range and reports the superseded draft",()=>{
    const a=new SegmentAssembler();a.push("s",short("first",{timing:range(0,300)}),100);
    expect(a.push("s",short("duplicate",{timing:range(0,300)}),200)).toEqual({ready:[],supersededSegmentIds:["duplicate"]});
  });
  it("preserves the same word spoken by different speakers even without timing",()=>{
    const a=new SegmentAssembler();
    a.push("s",short("first",{speaker:{speakerId:"speaker-a",role:"speaker",source:"diarization"}}),100);
    expect(a.push("s",short("second",{speaker:{speakerId:"speaker-b",role:"speaker",source:"diarization"}}),200).ready).toHaveLength(1);
  });
  it("keeps different explicit turns and confirmed languages separate",()=>{
    const a=new SegmentAssembler();a.push("s",short("first",{turnId:"turn-a"}),100);
    expect(a.push("s",short("second",{turnId:"turn-b"}),200).ready).toHaveLength(1);
    const b=new SegmentAssembler();b.push("s",short("first",{text:"No.",language:"en"}),100);
    expect(b.push("s",short("second",{text:"No.",language:"es"}),200).ready).toHaveLength(1);
  });
  it("does not invent speaker equality for explicit overlap or unknown attribution",()=>{
    for(const patch of [{timing:{...range(0,300),overlap:true}},{speaker:{speakerId:"unknown",role:"unknown" as const,source:"unknown" as const}}]){
      const a=new SegmentAssembler();a.push("s",short("first",patch),100);
      expect(a.push("s",short("second",patch),200).ready).toHaveLength(1);
    }
  });
  it("retains same-ID revision idempotency and permits a later correction",()=>{
    const a=new SegmentAssembler();a.push("s",short("same",{timing:range(0,300)}),100);
    expect(a.push("s",short("same",{timing:range(450,700)}),200).ready).toEqual([]);
    expect(a.push("s",short("same",{text:"Okay, yes.",revision:2,timing:range(0,300)}),300).ready).toMatchObject([{revision:2,text:"Okay, yes."}]);
  });
  it("retains the old text/time fallback when no independent audio context exists",()=>{
    const a=new SegmentAssembler();a.push("s",short("first"),100);
    expect(a.push("s",short("second"),200).ready).toEqual([]);
  });
});
