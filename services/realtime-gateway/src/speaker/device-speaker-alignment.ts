import type {SegmentTimingDto} from "@translation/contracts";
import type {SpeakerSpan} from "./speaker-attribution-provider.js";
import {evaluateSpeakerSpan,MINIMUM_SPEAKER_EVIDENCE_MS} from "./speaker-segment-aligner.js";
import {DEFAULT_MINIMUM_CONFIDENCE} from "./speech-turn-coordinator.js";

/** One policy for immutable phone evidence, both before ASR assembly and after
 * caption persistence. Dominance cannot erase even a short rival voice. */
export function deviceSpeakerAlignment(timing:SegmentTimingDto|undefined,spans:SpeakerSpan[]) {
  if(!timing)return undefined;
  const clipped=spans.map(s=>({...s,startMs:Math.max(timing.startMs,s.startMs),endMs:Math.min(timing.endMs,s.endMs)}))
    .filter(s=>s.endMs>s.startMs).sort((a,b)=>a.startMs-b.startMs);
  if(!clipped.length)return undefined;
  const ids=[...new Set(clipped.map(s=>s.speakerId))];
  const overlapIds=new Set(clipped.filter(s=>s.overlap).map(s=>s.speakerId));
  const ends=new Map<string,number>();
  for(const span of clipped){
    for(const [id,end] of ends)if(id!==span.speakerId&&end>span.startMs){overlapIds.add(id);overlapIds.add(span.speakerId);}
    ends.set(span.speakerId,Math.max(ends.get(span.speakerId)??0,span.endMs));
  }
  const overlap=timing.overlap===true||overlapIds.size>0;
  const unknown={speaker:{speakerId:"unknown",role:"unknown" as const,source:"unknown" as const},
    timing:{...timing,overlap,activeSpeakerIds:overlap?[...new Set([...(timing.activeSpeakerIds??[]),...overlapIds])].sort():[]}};
  if(overlap||ids.length!==1||(timing.activeSpeakerIds??[]).some(id=>id!==ids[0]))return unknown;
  let end=-Infinity,coverage=0;
  for(const s of clipped){coverage+=Math.max(0,s.endMs-Math.max(s.startMs,end));end=Math.max(end,s.endMs);}
  if(coverage<MINIMUM_SPEAKER_EVIDENCE_MS||coverage/(timing.endMs-timing.startMs)<0.5)return unknown;
  const {alignment}=evaluateSpeakerSpan(timing,clipped);
  if(!alignment||(alignment.speaker.confidence??0)<DEFAULT_MINIMUM_CONFIDENCE)return unknown;
  return {speaker:alignment.speaker,timing:{...timing,overlap:false,activeSpeakerIds:[]}};
}
