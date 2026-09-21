import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {evaluateSpeakerDiarization} from '../lib/speaker_eval_metrics.mjs';
const root=resolve(process.argv[2]??'.cache/speaker-validation-20260921');
const manifest=JSON.parse(readFileSync(join(root,'phone/manifest.json')));
const baseline=JSON.parse(readFileSync(join(root,'frozen-v1-result.json')));
const device=JSON.parse(readFileSync(join(root,'device-result.json')));
if(baseline.status!=='completed'||device.status!=='completed')throw Error('Both real inference arms must complete');
const compare=[];
const predictions={frozen:{cases:[]},device:{cases:[]}};
for(const item of manifest.cases){
  const old=baseline.cases.find(c=>c.id===item.id),current=device.cases.find(c=>c.id===item.id);
  if(old?.sha256!==item.sha256||current?.sha256!==item.sha256||old.inputSamples!==item.inputSamples||current.inputSamples!==item.inputSamples)throw Error(`Unequal PCM: ${item.id}`);
  let sequence=0,through=0;
  const spans=[];
  for(const event of current.evidence){
    if(event.sessionId!==item.id||event.sampleRate!==item.sampleRate||event.sequence<=sequence||event.throughSample<=through||event.throughSample>item.inputSamples)throw Error('Invalid device clock');
    for(const s of event.spans){
      if(s.startSample<through||s.endSample>event.throughSample||s.endSample<=s.startSample||s.speaker<0||s.speaker>=4)throw Error('Invalid speaker span');
      spans.push({speakerId:`speaker_${s.speaker+1}`,startMs:s.startSample/item.sampleRate*1000,endMs:s.endSample/item.sampleRate*1000,confidence:s.confidence,overlap:s.overlap});
    }
    sequence=event.sequence;through=event.throughSample;
  }
  const durationMs=item.inputSamples/item.sampleRate*1000,oldSpans=merge(old.spans),newSpans=merge(spans);
  predictions.frozen.cases.push({id:item.id,predicted:oldSpans});predictions.device.cases.push({id:item.id,predicted:newSpans});
  const score=predicted=>evaluateSpeakerDiarization({durationMs,frameMs:20,reference:item.reference,predicted});
  const frozen=score(oldSpans),candidate=score(newSpans);
  compare.push({id:item.id,samePcmSha256:item.sha256,durationMs,clockPassed:through===item.inputSamples,
    frozenV1:frozen,deviceV11:candidate,deviceSpeakerCount:new Set(spans.map(s=>s.speakerId)).size,
    expectedSpeakerCount:new Set(item.reference.map(s=>s.speakerId)).size,
    frozenSpeakerCount:new Set(oldSpans.map(s=>s.speakerId)).size,
    inferenceRtf:current.diagnostics.totalProcessingMs/durationMs,maximumProcessingMs:current.diagnostics.maximumProcessingMs,
    peakAppResidentBytes:current.peakAppResidentBytes,thermalState:current.thermalState,
    derGate:candidate.diarizationErrorRate<=.20?'PASS':'FAIL'});
}
const report={schemaVersion:1,status:'REAL_DEVICE_COMPARISON_COMPLETED',candidateId:device.candidateId,
  modelRevision:device.modelRevision,modelLoadMs:device.modelLoadMs,sourceCommit:device.sourceCommit,
  sameInputVerified:true,scorer:'unchanged frozen 1.0 speaker_eval_metrics.mjs; 20ms, no collar, overlap included',
  caveat:'DER gate only, not full speaker stability, public ASR/MT/TTS end-to-end or identity recognition. Inspect extra labels and confusion separately; thresholds not relaxed.',cases:compare};
writeFileSync(join(root,'comparison.json'),JSON.stringify(report,null,2));
for(const [name,value] of Object.entries(predictions))writeFileSync(join(root,`${name}-predictions.json`),JSON.stringify(value,null,2));
writeFileSync(join(root,'scoring-suite.json'),JSON.stringify({cases:manifest.cases.map(c=>({id:c.id,durationMs:c.inputSamples/c.sampleRate*1000,reference:c.reference}))},null,2));
console.log(JSON.stringify(report,null,2));
function merge(spans){
  const output=[];
  for(const speaker of new Set(spans.map(s=>s.speakerId))){
    let last;
    for(const s of spans.filter(s=>s.speakerId===speaker).sort((a,b)=>a.startMs-b.startMs)){
      if(last&&s.startMs<=last.endMs){last.endMs=Math.max(last.endMs,s.endMs);last.overlap||=s.overlap===true;}
      else {last={...s};output.push(last);}
    }
  }
  return output.sort((a,b)=>a.startMs-b.startMs);
}
