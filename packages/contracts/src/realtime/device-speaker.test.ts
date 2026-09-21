import { describe, expect, it } from "vitest";
import { deviceSpeakerProfile, isDeviceSpeakerSelection, parseDeviceSpeakerEvidence, type DeviceSpeakerEvidenceEvent } from "./device-speaker.js";
const scope = {sessionId:"session",sampleRate:16000 as const,acceptedSamples:16000};
const event = (): DeviceSpeakerEvidenceEvent => ({type:"speaker.evidence",sessionId:"session",profile:deviceSpeakerProfile.id,
  modelRevision:deviceSpeakerProfile.revision,sequence:1,sampleRate:16000,throughSample:16000,
  spans:[{speaker:0,startSample:0,endSample:16000,confidence:0.9,overlap:false}]});
describe("anonymous on-device speaker evidence",()=>{
  it("accepts a bounded observation but does not mutate caller data",()=>{
    const raw=event(),copy=parseDeviceSpeakerEvidence(raw,scope)!;copy.spans[0].speaker=1;
    expect(raw.spans[0].speaker).toBe(0);
  });
  it.each([
    ["owner scope",(e:any)=>e.sessionId="other"],
    ["model revision",(e:any)=>e.modelRevision="unknown"],
    ["sample rate",(e:any)=>e.sampleRate=24000],
    ["future audio",(e:any)=>e.throughSample=16001],
    ["identity claim",(e:any)=>e.spans[0].role="self"],
    ["speaker limit",(e:any)=>e.spans[0].speaker=4],
    ["negative sample",(e:any)=>e.spans[0].startSample=-1],
    ["reversed range",(e:any)=>e.spans[0].endSample=0],
    ["bad confidence",(e:any)=>e.spans[0].confidence=NaN],
    ["unbounded spans",(e:any)=>e.spans=Array(129).fill(e.spans[0])],
  ] as const)("rejects %s",(_name,mutate)=>{const e=event();mutate(e);expect(parseDeviceSpeakerEvidence(e,scope)).toBeNull();});
  it("requires explicit anonymous-only model selection",()=>{
    const value={mode:"diarization",maxSpeakers:4,allowVoiceIdentity:false,deviceProfile:deviceSpeakerProfile.id};
    expect(isDeviceSpeakerSelection(value)).toBe(true);
    expect(isDeviceSpeakerSelection({...value,allowVoiceIdentity:true})).toBe(false);
    expect(isDeviceSpeakerSelection({...value,displayName:"Known user"})).toBe(false);
  });
});
