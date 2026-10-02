import {createHash} from 'node:crypto';
import type {DeviceSpeakerEvidenceEvent,AsrTokenTimingDto} from '@translation/contracts';
import type {RevisableSpeakerSegment,SpeakerRevisionReconcileResult} from '../speaker/speaker-revision-reconciler.js';
import {realtimeLogger} from './realtime-metrics.js';
import type {RepeatedAsrExpansion} from '../asr/repeated-transcript-expansion.js';

const enabled=()=>process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED==='true';
const emit=(value:object)=>{if(enabled())try{realtimeLogger.info(value,'Public audio evidence trace');}catch{/* diagnostics cannot stop audio */}};

/** Call only after original session/model/rate/watermark validation. No raw
 * text, PCM or identity embeddings are accepted by this trace. */
export function traceAcceptedDeviceSpeaker(event:DeviceSpeakerEvidenceEvent,acceptedSamples:number){
  if(!enabled())return;
  emit({stage:'phone_speaker_evidence',sessionId:event.sessionId,sequence:event.sequence,profile:event.profile,
    modelRevision:event.modelRevision,sampleRate:event.sampleRate,throughSample:event.throughSample,acceptedSamples,
    spans:event.spans.map(s=>({speaker:s.speaker,startSample:s.startSample,endSample:s.endSample,confidence:s.confidence,overlap:s.overlap}))});
}

export function traceDeviceSpeakerAssociation(sessionId:string,throughMs:number,generation:number,
  segments:RevisableSpeakerSegment[],result:SpeakerRevisionReconcileResult){
  if(!enabled())return;
  emit({stage:'gateway_speaker_association',sessionId,throughMs,generation,accepted:result.accepted,reason:result.reason,
    totalSegments:segments.length,truncated:segments.length>32,
    segments:segments.slice(-32).map(s=>({segmentId:s.segmentId,revision:s.revision,startMs:s.timing?.startMs,endMs:s.timing?.endMs,
      speakerId:s.speaker?.speakerId,overlap:s.timing?.overlap,activeSpeakerIds:s.timing?.activeSpeakerIds,tokenCount:s.tokenTimings?.length??0})),
    updates:result.updates.slice(-32).map(s=>({segmentId:s.segmentId,revision:s.revision,speakerRevision:s.speakerRevision,
      speakerId:s.speaker.speakerId,startMs:s.timing?.startMs,endMs:s.timing?.endMs,overlap:s.timing?.overlap,activeSpeakerIds:s.timing?.activeSpeakerIds}))});
}

export function tracePublicAsrFinal(sessionId:string,segmentId:string,text:string,startMs:number,endMs:number,tokens?:AsrTokenTimingDto[]){
  if(!enabled())return;
  emit({stage:'provider_final',sessionId,segmentId,startMs,endMs,textSha256:createHash('sha256').update(text,'utf8').digest('hex'),
    textUtf16Length:text.length,tokenCount:tokens?.length??0,
    tokenOffsets:tokens?.map(t=>({startMs:t.startMs,endMs:t.endMs,characterStart:t.characterStart,characterEnd:t.characterEnd}))});
}

/** Quarantine diagnostics contain a hash and bounded measurements, never the
 * rejected transcript, credentials or PCM. Logging failure must not stop audio. */
export function traceRejectedAsrExpansion(sessionId:string,segmentId:string,text:string,rejection:RepeatedAsrExpansion){
  try{realtimeLogger.warn({sessionId,segmentId,...rejection,
    textSha256:createHash('sha256').update(text,'utf8').digest('hex')},'Public ASR repeated expansion rejected');}catch{}
}
