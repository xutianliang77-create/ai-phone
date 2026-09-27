import {describe,it,expect} from "vitest";
import type {SessionSegmentDto} from "@translation/contracts";
import {applySessionSegmentPatch,mergeSessionSegments} from "./session-segment-merge.js";
const speaker=(id:string,confidence=.98)=>({speakerId:id,role:"speaker" as const,source:"diarization" as const,confidence});
const timing=(endMs:number)=>({startMs:17048,endMs,source:"estimated" as const});
const parent=():SessionSegmentDto=>({id:"parent",sourceText:"First clause.",translatedText:"old",revision:1,speakerRevision:7,
  speaker:speaker("device-speaker-1"),timing:timing(20224)});
describe("speaker metadata belongs to one transcript revision",()=>{
  it("applies a newer transcript interval and starts a fresh metadata epoch",()=>{
    const s=parent();applySessionSegmentPatch(s,{segmentId:"parent",sourceText:"First clause, then its continuation.",revision:2,
      speaker:speaker("device-speaker-1",.96),timing:timing(23232)},{versionedSpeakerMetadata:true});
    expect(s).toMatchObject({revision:2,timing:timing(23232),speaker:{confidence:.96},translatedText:""});
    expect(s.speakerRevision).toBeUndefined();
    applySessionSegmentPatch(s,{segmentId:"parent",revision:1,speakerRevision:999,speaker:speaker("device-speaker-4"),timing:timing(20224)});
    expect(s.speaker?.speakerId).toBe("device-speaker-1");expect(s.timing).toEqual(timing(23232));
    applySessionSegmentPatch(s,{segmentId:"parent",revision:2,speakerRevision:1,speaker:speaker("device-speaker-2")});
    expect(s).toMatchObject({speakerRevision:1,speaker:{speakerId:"device-speaker-2"}});
  });
  it("does not compare full-snapshot metadata counters across transcript revisions",()=>{
    const next={...parent(),sourceText:"Joined text.",revision:2,speakerRevision:1,speaker:speaker("device-speaker-2"),timing:timing(23232)};
    const [merged]=mergeSessionSegments([parent()],[next],{versionedSpeakerMetadata:true});
    expect(merged).toMatchObject({revision:2,speakerRevision:1,timing:timing(23232),speaker:{speakerId:"device-speaker-2"}});
    expect(mergeSessionSegments([merged],[{...parent(),speakerRevision:999}])).toEqual([merged]);
  });
  it("preserves newer metadata for the same transcript and legacy unversioned metadata",()=>{
    const s=parent();applySessionSegmentPatch(s,{segmentId:"parent",revision:1,translatedText:"new MT",speaker:speaker("device-speaker-4"),timing:timing(12345)});
    expect(s.speaker?.speakerId).toBe("device-speaker-1");expect(s.timing).toEqual(timing(20224));
    applySessionSegmentPatch(s,{segmentId:"parent",speakerRevision:8,speaker:speaker("device-speaker-2")});
    expect(s.speaker?.speakerId).toBe("device-speaker-2");
  });
});
