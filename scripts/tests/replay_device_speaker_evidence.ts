import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseDeviceSpeakerEvidence,type TranscriptFinalEvent,type ServerRealtimeEvent} from '@translation/contracts';
import {DeviceSpeakerTimeline} from '../../services/realtime-gateway/src/speaker/device-speaker-timeline.js';
const root=resolve(process.argv[2]??'.cache/speaker-validation-20260921');
const device=JSON.parse(readFileSync(join(root,'device-result.json'),'utf8'));
const manifest=JSON.parse(readFileSync(join(root,'phone/manifest.json'),'utf8'));
const reports=[];
for(const item of device.cases){
  const reference=manifest.cases.find((c:any)=>c.id===item.id);
  if(!reference||reference.sha256!==item.sha256)throw Error('recording mismatch');
  const updates:ServerRealtimeEvent[]=[],timeline=new DeviceSpeakerTimeline(item.id,e=>updates.push(e));
  const incoming:Array<{at:number;run:()=>void}>=[];
  for(const raw of item.evidence){
    const {observedInputSamples,...wire}=raw;
    const accepted=parseDeviceSpeakerEvidence(wire,{sessionId:item.id,sampleRate:item.sampleRate,acceptedSamples:observedInputSamples});
    if(!accepted)throw Error('Real native evidence violates the existing server contract');
    incoming.push({at:observedInputSamples/item.sampleRate*1000,run:()=>timeline.accept(accepted)});
  }
  reference.reference.forEach((span:any,index:number)=>{
    // Oracle timing only to isolate the metadata path; this is not an ASR/MT
    // or real-network result and deliberately never invokes a public supplier.
    const final:TranscriptFinalEvent={type:'transcript.final',sessionId:item.id,segmentId:`segment-${index}`,
      revision:1,text:`Timing fixture ${index}`,language:'en',timing:{startMs:span.startMs,endMs:span.endMs,source:'model'}};
    incoming.push({at:span.endMs+400,run:()=>timeline.observe(final)});
  });
  for(const event of incoming.sort((a,b)=>a.at-b.at))event.run();
  const finalLabels=new Map<string,string>();
  for(const event of updates){
    if(event.type!=='speaker.updated'||'text' in event)throw Error('Unexpected ASR/MT or text mutation');
    finalLabels.set(event.segmentId,event.speaker?.speakerId??'unknown');
  }
  reports.push({id:item.id,contractPassed:true,expectedTimedSegments:reference.reference.length,
    updatedSegments:finalLabels.size,unknownSegments:reference.reference.length-[...finalLabels.values()].filter(s=>s!=='unknown').length,
    finalLabels:Object.fromEntries(finalLabels),onlyMetadataUpdates:true});
}
const result={status:'HOST_REPLAY_OF_REAL_DEVICE_EVIDENCE',sourceCommit:device.sourceCommit,
  limits:'Uses oracle transcript timing, not actual online ASR or a device-to-Gateway session. No supplier calls.',cases:reports};
writeFileSync(join(root,'gateway-metadata-replay.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
