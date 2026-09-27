import {describe,expect,it} from "vitest";
import {attributeSpeakerTranscripts} from "./speaker-transcript-attribution.js";

describe("confirmed short speaker evidence is not timing padding",()=>{
  it.each([1,48,88,120,159])("retains a second speaker even when its observed duration is %sms",duration=>{
    const raw={segmentId:"mixed",text:"好，我们需要检查日志。",revision:1,language:"zh" as const,turnId:"old-turn",
      timing:{startMs:1000,endMs:3000,source:"estimated" as const}};
    const edge={boundaryMs:1000+duration,previousSpeakerId:"old",nextSpeakerId:"new",previousTurnId:"old-turn",nextTurnId:"new-turn"};
    const spans=[{speakerId:"old",startMs:1000,endMs:edge.boundaryMs,confidence:0.99,overlap:false},
      {speakerId:"new",startMs:edge.boundaryMs,endMs:3000,confidence:0.99,overlap:false}];
    const result=attributeSpeakerTranscripts([raw],spans,()=>undefined,[edge],()=>true,{deviceBoundaryPolicy:true})[0];
    expect(result.speaker?.speakerId).toBe("unknown");
    expect(result.turnId).toBe("old-turn");expect(result.timing?.overlap).toBe(false);
    expect(result.text).toBe(raw.text);expect(result.timing?.startMs).toBe(1000);
  });

  it("also preserves real short speech at the end instead of assigning it all to the prior speaker",()=>{
    const raw={segmentId:"mixed",text:"我们准备好了，对。",language:"zh" as const,turnId:"next-turn",
      timing:{startMs:1000,endMs:3000,source:"estimated" as const}};
    const spans=[{speakerId:"old",startMs:1000,endMs:2880,confidence:0.99,overlap:false},
      {speakerId:"new",startMs:2880,endMs:3000,confidence:0.99,overlap:false}];
    const result=attributeSpeakerTranscripts([raw],spans,()=>undefined,[{boundaryMs:2880,previousSpeakerId:"old",nextSpeakerId:"new",previousTurnId:"old-turn",nextTurnId:"next-turn"}],()=>true,{deviceBoundaryPolicy:true})[0];
    expect(result.speaker?.speakerId).toBe("unknown");expect(result.turnId).toBe("next-turn");expect(result.timing?.overlap).toBe(false);
  });
});
