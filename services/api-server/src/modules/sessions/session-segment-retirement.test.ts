import {describe,it,expect} from "vitest";
import type {SessionRecord} from "./session-record.js";
import {applyStoredSessionSegmentPatch} from "./session-segment-write.js";
import {mergeSessionSegments} from "./session-segment-merge.js";
import {segmentRetirementAck,sessionSegmentRevisionWatermarks} from "./session-segment-retirement.js";
import {isValidSegmentPatch} from "../realtime/realtime-segment-validation.js";
const record=()=>({id:"session",segments:[{id:"child",sourceText:"before",translatedText:"translated",revision:1}],processingAuthorization:{processingMode:"online"}} as SessionRecord);
describe("durable public caption retirement",()=>{
  it("accepts current MT and speaker metadata only after a newer source has restored the caption",()=>{
    const s=record();applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:3,translatedText:"premature"});
    expect(s.segments).toEqual([]);
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:3,sourceText:"restored"});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:3,translatedText:"current",targetLanguage:"en"});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:3,speakerRevision:1,
      speaker:{speakerId:"device-speaker-2",role:"speaker",source:"diarization"},timing:{startMs:1000,endMs:2000,source:"estimated"}});
    expect(s.segments[0]).toMatchObject({revision:3,sourceText:"restored",translatedText:"current",
      speaker:{speakerId:"device-speaker-2"},timing:{startMs:1000,endMs:2000}});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,translatedText:"stale"});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true});
    expect(s.segments[0].translatedText).toBe("current");
    expect(sessionSegmentRevisionWatermarks(s)).toEqual({child:3});
  });
  it("is idempotent, rejects stale revival and permits a genuinely newer source revision",()=>{
    const s=record();applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true});
    for(const patch of [{segmentId:"child",revision:1,sourceText:"old"},{segmentId:"child",revision:2,sourceText:"equal"},
      {segmentId:"child",revision:99,translatedText:"source-less MT"},{segmentId:"child",revision:1,speakerRevision:999,timing:{startMs:0,endMs:1000,source:"estimated" as const}}])applyStoredSessionSegmentPatch(s,patch);
    expect(s.segments).toEqual([]);expect(s.retiredSegmentRevisions).toEqual({child:2});
    expect(segmentRetirementAck(s,"child")).toEqual({sessionId:"session",segmentId:"child",revision:2,retired:true});
    const stale=[{id:"child",sourceText:"old",translatedText:"old",revision:1}];
    expect(mergeSessionSegments([],stale,{retiredSegmentRevisions:s.retiredSegmentRevisions})).toEqual([]);
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:3,sourceText:"legitimate new recognition"});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true});
    expect(s.segments).toHaveLength(1);expect(segmentRetirementAck(s,"child")).toMatchObject({revision:3,retired:false});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:4,retired:true});
    expect(s.segments).toEqual([]);expect(sessionSegmentRevisionWatermarks(s)).toEqual({child:4});
  });
  it("keeps a never-emitted child retired without affecting other sessions",()=>{
    const s=record();s.segments=[];const other=record();
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true});
    applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:1,sourceText:"late"});
    expect(s.segments).toEqual([]);expect(other.segments).toHaveLength(1);
  });
  it("does not interpret retirement in the private legacy path or accept malformed commands",()=>{
    const s=record();delete s.processingAuthorization;
    expect(()=>applyStoredSessionSegmentPatch(s,{segmentId:"child",revision:2,retired:true})).toThrow("public_segment_retirement_required");
    expect(s.segments).toHaveLength(1);
    const valid={sessionId:"session",segmentId:"child",revision:2,retired:true as const};
    expect(isValidSegmentPatch(valid)).toBe(true);
    for(const extra of [{sourceText:""},{translatedText:"text"},{revision:0},{revision:-1},{revision:1.5},{revision:Number.MAX_SAFE_INTEGER+1},{segmentId:""},{retired:false},{retired:"true"}])expect(isValidSegmentPatch({...valid,...extra} as never)).toBe(false);
  });
  it("treats unusual segment IDs as data, never as object prototypes",()=>{
    const s=record();applyStoredSessionSegmentPatch(s,{segmentId:"__proto__",revision:2,retired:true});
    expect(Object.getPrototypeOf(s.retiredSegmentRevisions)).toBe(Object.prototype);
    expect(Object.hasOwn(s.retiredSegmentRevisions!,"__proto__")).toBe(true);
    expect(segmentRetirementAck(s,"__proto__")).toMatchObject({revision:2,retired:true});
    expect(({} as {polluted?:boolean}).polluted).toBeUndefined();
  });
});
