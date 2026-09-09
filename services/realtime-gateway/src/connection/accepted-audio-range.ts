import type {AudioFrame} from "@translation/contracts";
export interface AcceptedAudioRange {startSample:number;endSample:number;}
const accepted=new WeakMap<AudioFrame,AcceptedAudioRange&{sessionId:string;sequence:number;sampleRate:number;data:string}>();
/** Server-owned object metadata, never trusted from JSON fields or client clocks. */
export function markAcceptedAudioRange(frame:AudioFrame,range:AcceptedAudioRange){
  const pcm=Buffer.from(frame.data,"base64");
  if(frame.format!=="pcm16"||!pcm.length||pcm.length%2||pcm.toString("base64")!==frame.data||
    !Number.isSafeInteger(range.startSample)||range.startSample<0||!Number.isSafeInteger(range.endSample)||range.endSample-range.startSample!==pcm.length/2)throw Error("invalid_accepted_audio_range");
  accepted.set(frame,{...range,sessionId:frame.sessionId,sequence:frame.sequence,sampleRate:frame.sampleRate,data:frame.data});
}
export function acceptedAudioRange(frame:AudioFrame):AcceptedAudioRange|undefined {
  const r=accepted.get(frame);if(!r)return undefined;
  if(frame.sessionId!==r.sessionId||frame.sequence!==r.sequence||frame.sampleRate!==r.sampleRate||frame.data!==r.data||frame.format!=="pcm16")throw Error("accepted_audio_frame_changed");
  return {startSample:r.startSample,endSample:r.endSample};
}
export function inheritAcceptedAudioRange(frames:AudioFrame[],merged:AudioFrame){
  const ranges=frames.map(acceptedAudioRange);if(ranges.every(r=>r===undefined))return;
  if(ranges.some((r,i)=>!r||i>0&&ranges[i-1]!.endSample!==r.startSample))throw Error("accepted_audio_range_gap");
  markAcceptedAudioRange(merged,{startSample:ranges[0]!.startSample,endSample:ranges.at(-1)!.endSample});
}
