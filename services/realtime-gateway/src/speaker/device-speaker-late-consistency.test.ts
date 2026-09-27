import {describe,expect,it} from "vitest";
import {deviceSpeakerProfile,type ServerRealtimeEvent} from "@translation/contracts";
import {DeviceSpeakerTimeline} from "./device-speaker-timeline.js";
import {attributeSpeakerTranscripts} from "./speaker-transcript-attribution.js";

const unknown={speakerId:"unknown",role:"unknown" as const,source:"unknown" as const};
describe("phone speaker evidence keeps the same early and late attribution policy",()=>{
  it.each([1,80,135,159])("does not overwrite a real %sms rival at the segment edge",duration=>{
    const updates:ServerRealtimeEvent[]=[],timeline=new DeviceSpeakerTimeline("s",e=>updates.push(e));
    const input={segmentId:"a",revision:1,turnId:"turn_1",text:"完整原文。",language:"zh" as const,
      speaker:unknown,timing:{startMs:0,endMs:2567,source:"estimated" as const,overlap:false,activeSpeakerIds:[]}};
    const spans=[{speakerId:"device-speaker-2",startMs:0,endMs:duration,confidence:.99},
      {speakerId:"device-speaker-1",startMs:duration,endMs:2567,confidence:.99}];
    const [early]=attributeSpeakerTranscripts([input],spans,()=>undefined,[],()=>true,{deviceBoundaryPolicy:true});
    expect(early.speaker?.speakerId).toBe("unknown");
    timeline.observe({...input,type:"transcript.final",sessionId:"s"});
    timeline.accept({type:"speaker.evidence",sessionId:"s",profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
      sampleRate:16000,sequence:1,throughSample:2567*16,spans:spans.map(s=>({speaker:s.speakerId==="device-speaker-1"?0:1,
        startSample:s.startMs*16,endSample:s.endMs*16,confidence:s.confidence,overlap:false}))});
    expect(updates.some(e=>e.type==="speaker.updated"&&e.speaker.speakerId!=="unknown")).toBe(false);
  });
  it("does not promote low-confidence evidence just because it is the only slot",()=>{
    const updates:ServerRealtimeEvent[]=[],timeline=new DeviceSpeakerTimeline("s",e=>updates.push(e));
    timeline.observe({type:"transcript.final",sessionId:"s",segmentId:"a",revision:1,text:"Original.",language:"en",
      speaker:unknown,timing:{startMs:0,endMs:1000,source:"estimated"}});
    timeline.accept({type:"speaker.evidence",sessionId:"s",profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
      sampleRate:16000,sequence:1,throughSample:16000,spans:[{speaker:0,startSample:0,endSample:16000,confidence:.55,overlap:false}]});
    expect(updates).toEqual([]);
  });
  it("keeps the same confirmed interior boundary in the later timeline even with an uncovered edge",()=>{
    const updates:ServerRealtimeEvent[]=[],timeline=new DeviceSpeakerTimeline("s",e=>updates.push(e),()=>[
      {boundaryMs:500,previousSpeakerId:"device-speaker-2",nextSpeakerId:"device-speaker-1"}]);
    timeline.observe({type:"transcript.final",sessionId:"s",segmentId:"a",revision:1,text:"Original.",language:"en",
      speaker:unknown,timing:{startMs:0,endMs:2000,source:"estimated"}});
    timeline.accept({type:"speaker.evidence",sessionId:"s",profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
      sampleRate:16000,sequence:1,throughSample:32000,spans:[{speaker:0,startSample:8000,endSample:32000,confidence:.98,overlap:false}]});
    expect(updates).toEqual([]);
  });
});
