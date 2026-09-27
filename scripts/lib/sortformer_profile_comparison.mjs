import {evaluateSpeakerDiarization} from './speaker_eval_metrics.mjs';

export function compareSortformerProfiles(manifest,arms,manifestSha256){
  if(!Array.isArray(manifest.cases)||manifest.cases.length<4||manifest.cases.length>12||arms.length!==2)throw Error('Comparison scope invalid');
  const profiles=['sortformer_v2_1_fastest','sortformer_v2_1_balanced'];
  if(new Set(arms.map(x=>x.profile)).size!==2||arms.some(x=>!profiles.includes(x.profile)))throw Error('Need both fixed model profiles');
  if(new Set(arms.map(x=>x.settingsSha256)).size!==1)throw Error('Different activity grids');
  const expected=new Map(manifest.cases.map(c=>[c.id,c]));
  if(expected.size!==manifest.cases.length||!manifest.cases.some(c=>c.evaluationRole==='calibration')||
    !manifest.cases.some(c=>c.evaluationRole==='validation'))throw Error('Independent roles required');
  const scored=arms.map(arm=>{
    if(arm.status!=='completed'||arm.modelRevision!==manifest.modelRevision||arm.manifestSha256!==manifestSha256||
      !Array.isArray(arm.variants)||arm.variants.length<1||arm.variants.length>256||
      !arm.variants.some(v=>v.name==='baseline')||new Set(arm.variants.map(v=>v.name)).size!==arm.variants.length)throw Error('Unbound or incomplete arm');
    return {profile:arm.profile,rawSha256:arm.rawSha256,variants:arm.variants.map(v=>scoreVariant(v,expected))};
  });
  const baseline=scored.find(a=>a.profile===profiles[0]).variants.find(v=>v.name==='baseline');
  if(!baseline||baseline.activity.onset!==.5||baseline.activity.offset!==.5||
    baseline.activity.minimumOnFrames!==2||baseline.activity.minimumOffFrames!==4)throw Error('Baseline policy changed');
  const assess=(arm,v)=>({profile:arm.profile,...v,validationPassed:v.cases.filter(c=>c.evaluationRole==='validation').every(c=>{
    const old=baseline.cases.find(x=>x.id===c.id);
    return c.metrics.diarizationErrorRate<=.20&&c.metrics.diarizationErrorRate<=old.metrics.diarizationErrorRate+.01&&
      Math.abs(c.predictedSpeakers-c.expectedSpeakers)<=Math.abs(old.predictedSpeakers-old.expectedSpeakers);
  })});
  // Ranking is fixed to calibration only. Validation/diagnostic failures never
  // cause a search for a more flattering runner-up on those same recordings.
  const selected=scored.map(arm=>assess(arm,[...arm.variants].sort((a,b)=>a.calibrationMicroDer-b.calibrationMicroDer||
    a.decoderHoldMs-b.decoderHoldMs||a.name.localeCompare(b.name))[0]));
  return {status:'HOST_COMPARISON_ONLY',manifestSha256,modelRevision:manifest.modelRevision,
    scorer:'unchanged speaker_eval_metrics.mjs; 20ms, zero collar, overlap included',
    selection:'calibration-only; validation per-case <=20% DER and <=baseline+1 percentage point; no worse speaker-count error',
    baseline,modelOnly:scored.map(arm=>assess(arm,arm.variants.find(v=>v.name==='baseline'))),selected,
    modelOrConfigAutomaticallyPromoted:false,deviceAccepted:false,
    allScores:scored};
}

export function compareSortformerCachePolicies(manifest,arms,manifestSha256){
  const allowed=[24,31,40],expected=new Map(manifest.cases.map(c=>[c.id,c]));
  if(arms.length!==3||new Set(arms.map(a=>a.cacheUpdateFrames)).size!==3||expected.size!==manifest.cases.length||
    !manifest.cases.some(c=>c.evaluationRole==='calibration')||!manifest.cases.some(c=>c.evaluationRole==='validation'))throw Error('Cache comparison scope invalid');
  const fixed=[];
  const scored=arms.map(arm=>{
    if(arm.status!=='completed'||arm.profile!=='sortformer_v2_1_fastest'||arm.modelRevision!==manifest.modelRevision||
      arm.manifestSha256!==manifestSha256||!allowed.includes(arm.cacheUpdateFrames)||arm.variants?.length!==1)throw Error('Cache arm binding invalid');
    const v=arm.variants[0];
    if(v.name!=='baseline'||v.activity.onset!==.5||v.activity.offset!==.5||v.activity.minimumOnFrames!==2||
      v.activity.minimumOffFrames!==4||v.decoderHoldMs!==320)throw Error('Post-processing changed');
    const settings={...arm.inferenceSettings};
    if(settings.cacheUpdateFrames!==arm.cacheUpdateFrames||settings.chunkFrames!==6||settings.leftFrames!==1||
      settings.rightFrames!==7||settings.fifoFrames!==40||settings.cacheFrames!==188||settings.sampleRate!==16000)throw Error('Static model configuration changed');
    delete settings.cacheUpdateFrames;fixed.push(JSON.stringify(Object.fromEntries(Object.entries(settings).sort())));
    return {...scoreVariant(v,expected),cacheUpdateFrames:arm.cacheUpdateFrames,rawSha256:arm.rawSha256};
  });
  if(new Set(fixed).size!==1||new Set(arms.map(a=>a.settingsSha256)).size!==1)throw Error('More than one inference parameter changed');
  const baseline=scored.find(a=>a.cacheUpdateFrames===31);
  const selected=[...scored].sort((a,b)=>a.calibrationMicroDer-b.calibrationMicroDer||
    Math.abs(a.cacheUpdateFrames-31)-Math.abs(b.cacheUpdateFrames-31))[0];
  const validationPassed=selected.cases.filter(c=>c.evaluationRole==='validation').every(c=>{
    const old=baseline.cases.find(x=>x.id===c.id);
    return c.metrics.diarizationErrorRate<=.20&&c.metrics.diarizationErrorRate<=old.metrics.diarizationErrorRate+.01&&
      Math.abs(c.predictedSpeakers-c.expectedSpeakers)<=Math.abs(old.predictedSpeakers-old.expectedSpeakers);
  });
  return {status:'HOST_FIXED_WEIGHT_CACHE_COMPARISON',manifestSha256,modelRevision:manifest.modelRevision,
    selectedCacheUpdateFrames:selected.cacheUpdateFrames,selection:'calibration-only, prefer baseline on ties',validationPassed,
    validationCaveat:'Reused regression samples, not a newly unseen acceptance set; historical microphone reference is approximate',
    modelOrConfigAutomaticallyPromoted:false,deviceAccepted:false,baseline,arms:scored};
}

function scoreVariant(v,expected){
  if(v.cases.length!==expected.size||new Set(v.cases.map(c=>c.id)).size!==expected.size)throw Error('Case count mismatch');
  const cases=v.cases.map(c=>{
    const e=expected.get(c.id);
    if(!e||c.sha256!==e.sha256||c.inputSamples!==e.inputSamples||e.sampleRate!==16000)throw Error('Unequal PCM');
    const durationMs=e.inputSamples/16;
    if(!Array.isArray(c.predicted)||c.predicted.some(s=>!/^speaker_[1-4]$/.test(s.speakerId)||
      !Number.isFinite(s.startMs)||!Number.isFinite(s.endMs)||s.startMs<0||s.startMs>=s.endMs||s.endMs>durationMs))throw Error('Invalid prediction');
    const metrics=evaluateSpeakerDiarization({durationMs,frameMs:20,reference:e.reference,predicted:c.predicted});
    return {id:c.id,evaluationRole:e.evaluationRole,sha256:e.sha256,metrics,
      expectedSpeakers:new Set(e.reference.map(s=>s.speakerId)).size,predictedSpeakers:new Set(c.predicted.map(s=>s.speakerId)).size};
  });
  const micro=role=>{const rows=cases.filter(c=>c.evaluationRole===role).map(c=>c.metrics);
    const denominator=rows.reduce((s,r)=>s+r.referenceSpeakerFrames,0);
    return denominator?rows.reduce((s,r)=>s+r.missed+r.falseAlarm+r.confusion,0)/denominator:null;};
  return {name:v.name,activity:v.activity,decoderHoldMs:v.decoderHoldMs,cases,
    calibrationMicroDer:micro('calibration'),validationMicroDer:micro('validation'),diagnosticMicroDer:micro('diagnostic')};
}
