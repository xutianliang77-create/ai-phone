import {describe,it,expect} from "vitest";
import {deviceSpeakerProfile,type DeviceSpeakerEvidenceEvent,type ServerRealtimeEvent} from "@translation/contracts";
import {DeviceSpeakerTimeline} from "./device-speaker-timeline.js";
function evidence(speakers:number[], sequence=1, start=0):DeviceSpeakerEvidenceEvent {
  return {type:"speaker.evidence",sessionId:"session",profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
    sequence,sampleRate:16000,throughSample:start+16000,spans:Array.from({length:12},(_,i)=>speakers.map(speaker=>({speaker,
      startSample:start+i*1280,endSample:start+(i+1)*1280,confidence:.95,overlap:speakers.length>1}))).flat()};
}
const final=(id="a",start=0,end=960):ServerRealtimeEvent=>({type:"transcript.final",sessionId:"session",segmentId:id,
  text:"Original text stays unchanged.",language:"en",revision:1,timing:{startMs:start,endMs:end,estimated:true}});
describe("phone timeline reuses metadata-only speaker revision",()=>{
  it("updates an already emitted caption after complete evidence without ASR, MT or text changes",()=>{
    const updates:ServerRealtimeEvent[]=[], timeline=new DeviceSpeakerTimeline("session",e=>updates.push(e));
    timeline.observe(final());expect(updates).toEqual([]);timeline.accept(evidence([1]));
    expect(updates).toHaveLength(1);expect(updates[0]).toMatchObject({type:"speaker.updated",segmentId:"a",revision:1,
      speakerRevision:1,speaker:{speakerId:"device-speaker-2",source:"diarization"}});
    expect(updates[0]).not.toHaveProperty("text");timeline.accept(evidence([],2,16000));expect(updates).toHaveLength(1);
  });
  it("keeps stable slots rather than renaming slot 2 to the first server label",()=>{
    const updates:any[]=[],timeline=new DeviceSpeakerTimeline("session",e=>updates.push(e));
    timeline.accept(evidence([2]));timeline.observe(final());expect(updates[0].speaker.speakerId).toBe("device-speaker-3");
  });
  it("retains true overlap made of consecutive 80ms frames",()=>{
    const updates:any[]=[],timeline=new DeviceSpeakerTimeline("session",e=>updates.push(e));
    timeline.observe(final());timeline.accept(evidence([0,1]));
    expect(updates[0]).toMatchObject({speaker:{speakerId:"unknown"},timing:{overlap:true,
      activeSpeakerIds:["device-speaker-1","device-speaker-2"]}});
  });
  it("does not lend the previous speaker to a silent/uncovered segment",()=>{
    const updates:any[]=[],timeline=new DeviceSpeakerTimeline("session",e=>updates.push(e));
    timeline.accept(evidence([0]));timeline.observe(final("silent",1500,1960));timeline.accept(evidence([],2,16000));
    expect(updates).toEqual([]);
  });
  it("drops absorbed drafts and foreign-session finals",()=>{
    const updates:any[]=[],timeline=new DeviceSpeakerTimeline("session",e=>updates.push(e));
    timeline.observe(final());timeline.observe({...final(),text:""} as ServerRealtimeEvent);
    timeline.observe({...final(),sessionId:"other"});timeline.accept(evidence([0]));expect(updates).toEqual([]);
  });
});
