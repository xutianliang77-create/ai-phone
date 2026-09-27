import {describe,expect,it} from "vitest";
import {SegmentAssembler} from "./segment-assembler.js";
import type {SpeechTranscript} from "./speech-transcript.js";

const speaker={speakerId:"device-speaker-1",role:"speaker" as const,source:"diarization" as const};
const project=(parts:SpeechTranscript[])=>parts.map(p=>({...p,speaker}));
const create=()=>new SegmentAssembler({emitSemanticContinuationRevisions:true,lateSpeakerRevisions:true});
function part(id:string,text:string,start=0):SpeechTranscript {
  return {segmentId:id,text,language:"zh",automaticLanguageStatus:"detected",turnId:"turn_1",revision:1,
    speaker:{speakerId:"unknown",role:"unknown",source:"unknown"},timing:{startMs:start,endMs:start+1000,source:"estimated"}};
}
const a=()=>part("a","我们需要 Alpha1。");
const b=()=>part("b","Beta2 和 Gamma3。",1000);
describe("bounded late speaker metadata reuses semantic revisions",()=>{
  it("emits originals immediately, then one replacement, suppressing stale originals",()=>{
    const s=create();expect(s.push("s",a(),0).ready).toEqual([a()]);expect(s.push("s",b(),1000).ready).toEqual([b()]);
    const result=s.refreshSpeakers("s",project,2000);
    expect(result.ready).toMatchObject([{segmentId:"a",revision:2,text:"我们需要 Alpha1、Beta2 和 Gamma3。"}]);
    expect(result.supersededSegmentIds).toEqual(["b"]);
    expect(s.refreshSpeakers("s",project,2100).ready).toEqual([]);
    expect(s.push("s",a(),2200).ready).toEqual([]);expect(s.push("s",b(),2300).ready).toEqual([]);
    expect(s.push("s",{...b(),speaker,revision:3,text:"Beta2 和 Gamma4。"},2400).ready)
      .toMatchObject([{segmentId:"a",revision:3,text:"我们需要 Alpha1、Beta2 和 Gamma4。"}]);
  });
  it("does not retranslate a lone metadata update or renew its five-second window",()=>{
    const s=create();s.push("s",a(),0);expect(s.refreshSpeakers("s",project,4900).ready).toEqual([]);
    s.push("s",b(),5001);expect(s.refreshSpeakers("s",project,5002).ready).toEqual([]);
  });
  it("keeps the original window while accumulating three independent outputs",()=>{
    const s=create();s.push("s",a(),0);s.push("s",b(),2000);s.push("s",part("c","Delta4 和 Epsilon5。",2000),4000);
    const result=s.refreshSpeakers("s",project,4999);
    expect(result.ready).toMatchObject([{segmentId:"a",revision:2,text:"我们需要 Alpha1、Beta2 和 Gamma3、Delta4 和 Epsilon5。"}]);
    expect(result.supersededSegmentIds).toEqual(["b","c"]);
  });
  it.each(["turn","language","gap","overlap","text","speaker"])("refuses incompatible %s",kind=>{
    const s=create(),second=b();
    if(kind==="turn")second.turnId="turn_2";
    if(kind==="language")second.language="en";
    if(kind==="gap")second.timing={startMs:1751,endMs:2751,source:"estimated"};
    if(kind==="overlap")second.timing={...second.timing!,overlap:true};
    if(kind==="text")second.text="缓存和数据库正常。";
    s.push("s",a(),0);s.push("s",second,1000);
    expect(s.refreshSpeakers("s",parts=>project(parts).map(p=>kind==="speaker"&&p.segmentId==="b"
      ?{...p,speaker:{...speaker,speakerId:"device-speaker-2"}}:p),2000).ready).toEqual([]);
  });
  it("checks the combined audio interval instead of overlooking a rival in a gap",()=>{
    const s=create();s.push("s",a(),0);s.push("s",{...b(),timing:{startMs:1200,endMs:2200,source:"estimated"}},1000);
    expect(s.refreshSpeakers("s",parts=>project(parts).map(p=>p.timing!.startMs===0&&p.timing!.endMs===2200
      ?{...p,speaker:{speakerId:"unknown",role:"unknown",source:"unknown"}}:p),2000).ready).toEqual([]);
  });
  it("never allows a metadata projection to change text or reuse a foreign segment",()=>{
    for(const field of ["text","segmentId"] as const){
      const s=create();s.push("s",a(),0);s.push("s",b(),1000);
      expect(s.refreshSpeakers("s",parts=>project(parts).map(p=>({...p,[field]:"forged"})),2000).ready).toEqual([]);
      expect(s.refreshSpeakers("s",project,2001).ready).toEqual([]);
    }
  });
  it("clears repair state at end/pause and isolates sessions",()=>{
    for(const action of ["clear","flush"]){
      const s=create();s.push("s",a(),0);s.push("s",b(),1000);
      expect(s.refreshSpeakers("other",project,1001).ready).toEqual([]);
      if(action==="clear")s.clear("s");else s.flush("s",1500);
      expect(s.refreshSpeakers("s",project,2000).ready).toEqual([]);
    }
  });
  it("does not expand the repair window or character cap with unrelated larger buffer settings",()=>{
    const s=new SegmentAssembler({emitSemanticContinuationRevisions:true,lateSpeakerRevisions:true,
      maxContinuationBufferMs:30000,maxBufferedSegments:8,maxBufferedCharacters:1000});
    s.push("s",a(),0);s.push("s",b(),1000);expect(s.refreshSpeakers("s",project,5001).ready).toEqual([]);
    const long={...a(),text:`我们需要 ${"Alpha1、".repeat(35)}Beta2。`};
    s.push("s",long,10000);s.push("s",b(),11000);expect(s.refreshSpeakers("s",project,12000).ready).toEqual([]);
  });
  it("does not lend a larger hard-endpoint window to a speaker-refreshed ordinary prefix",()=>{
    const s=new SegmentAssembler({emitSemanticContinuationRevisions:true,lateSpeakerRevisions:true,maxContinuationBufferMs:30000});
    s.push("s",a(),0);s.refreshSpeakers("s",project,4900);
    expect(s.push("s",{...b(),speaker},5001).ready).toMatchObject([{segmentId:"b",revision:1}]);
  });
});
