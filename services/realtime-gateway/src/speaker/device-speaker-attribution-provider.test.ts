import { expect, it } from "vitest";
import { deviceSpeakerProfile, type AudioFrame, type DeviceSpeakerEvidenceEvent } from "@translation/contracts";
import { markAcceptedAudioRange } from "../connection/accepted-audio-range.js";
import { DeviceSpeakerAttributionProvider } from "./device-speaker-attribution-provider.js";
const selection={mode:"diarization" as const,maxSpeakers:4 as const,allowVoiceIdentity:false,deviceProfile:deviceSpeakerProfile.id};
const evidence=():DeviceSpeakerEvidenceEvent=>({type:"speaker.evidence",sessionId:"session",profile:deviceSpeakerProfile.id,
  modelRevision:deviceSpeakerProfile.revision,sequence:1,sampleRate:16000,throughSample:3200,
  spans:[{speaker:0,startSample:0,endSample:1600,confidence:0.9,overlap:false},{speaker:1,startSample:1600,endSample:3200,confidence:0.9,overlap:false}]});
const frame=(start:number):AudioFrame=>{const value:AudioFrame={type:"audio.frame",sessionId:"session",sequence:start+1,timestampMs:0,format:"pcm16",sampleRate:16000,data:Buffer.alloc(3200).toString("base64")};markAcceptedAudioRange(value,{startSample:start,endSample:start+1600});return value;};
it("does not let metadata move the PCM watermark or escape its session",async()=>{
  const provider=new DeviceSpeakerAttributionProvider("session",16000);
  await provider.createSession({sessionId:"session",options:selection});
  expect(provider.accept(evidence(),1600)).toBe(false);
  expect(provider.accept({...evidence(),sessionId:"other"},3200)).toBe(false);
  expect(provider.accept(evidence(),3200)).toBe(true);
  expect(provider.accept(evidence(),3200)).toBe(false);
  expect(await provider.pushAudio(frame(0))).toEqual([{speakerId:"device-speaker-1",startMs:0,endMs:100,confidence:0.9,overlap:false,final:true}]);
  expect(await provider.pushAudio(frame(1600))).toHaveLength(1);
  expect(await provider.flush("session")).toEqual([]);
  await provider.closeSession("session");expect(provider.accept({...evidence(),sequence:2},3200)).toBe(false);
  expect(provider.controlsAsrEndpoints).toBe(false);expect(provider.requiresDirectEvidence).toBe(true);
});
