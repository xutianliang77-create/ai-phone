import {describe,it,expect} from 'vitest';
import {compareSortformerProfiles,compareSortformerCachePolicies} from './sortformer_profile_comparison.mjs';
const activity={onset:.5,offset:.5,minimumOnFrames:2,minimumOffFrames:4};
function fixture(){
  const cases=['c1','c2','v1','v2'].map(id=>({id,sha256:id,inputSamples:16000,sampleRate:16000,
    evaluationRole:id[0]==='c'?'calibration':'validation',reference:[{speakerId:'truth',startMs:0,endMs:1000}]}));
  const variant=(name,calibrationEnd,validationEnd)=>({name,activity,decoderHoldMs:320,cases:cases.map(c=>({
    id:c.id,sha256:c.sha256,inputSamples:c.inputSamples,predicted:[{speakerId:'speaker_1',startMs:0,endMs:c.evaluationRole==='calibration'?calibrationEnd:validationEnd}]}))});
  const arms=['sortformer_v2_1_fastest','sortformer_v2_1_balanced'].map(profile=>({profile,status:'completed',modelRevision:'fixed',manifestSha256:'manifest',settingsSha256:'same-grid',
    variants:[variant('baseline',900,1000),variant('best-calibration',1000,400),variant('better-validation',950,1000)]}));
  return {manifest:{modelRevision:'fixed',cases},arms};
}
describe('bounded Sortformer comparison uses frozen PCM and calibration-only selection',()=>{
  it('reports validation failure instead of picking a flattering validation runner-up',()=>{
    const f=fixture(),report=compareSortformerProfiles(f.manifest,f.arms,'manifest');
    expect(report.selected.map(v=>[v.name,v.validationPassed])).toEqual([['best-calibration',false],['best-calibration',false]]);
    expect(report.modelOrConfigAutomaticallyPromoted).toBe(false);expect(report.deviceAccepted).toBe(false);
  });
  it.each(['pcm','manifest','revision','grid','missing-case','duplicate-case','baseline','timestamp','speaker'])('rejects %s mismatch',kind=>{
    const f=fixture(),arm=f.arms[1];
    if(kind==='pcm')arm.variants[0].cases[0].sha256='wrong';
    if(kind==='manifest')arm.manifestSha256='wrong';
    if(kind==='revision')arm.modelRevision='wrong';
    if(kind==='grid')arm.settingsSha256='wrong';
    if(kind==='missing-case')arm.variants[0].cases.pop();
    if(kind==='duplicate-case')arm.variants[0].cases[0]=arm.variants[0].cases[1];
    if(kind==='baseline')arm.variants[0].name='not-baseline';
    if(kind==='timestamp')arm.variants[0].cases[0].predicted[0].endMs=1001;
    if(kind==='speaker')arm.variants[0].cases[0].predicted[0].speakerId='identity';
    expect(()=>compareSortformerProfiles(f.manifest,f.arms,'manifest')).toThrow();
  });
  it('does not claim baseline parity after silently changing its thresholds',()=>{
    const f=fixture();f.arms[0].variants[0].activity={...activity,onset:.6};
    expect(()=>compareSortformerProfiles(f.manifest,f.arms,'manifest')).toThrow('Baseline policy changed');
  });
});

function cacheFixture(){
  const f=fixture(),base=f.arms[0];
  const arms=[24,31,40].map(cacheUpdateFrames=>({...structuredClone(base),profile:'sortformer_v2_1_fastest',cacheUpdateFrames,
    inferenceSettings:{sampleRate:16000,chunkFrames:6,leftFrames:1,rightFrames:7,fifoFrames:40,cacheFrames:188,cacheUpdateFrames,
      silenceThreshold:.2,scoresBoostLatest:.05,predScoreThreshold:.25},variants:[structuredClone(base.variants[0])]}));
  return {...f,arms};
}
describe('fixed-weight cache transfer comparison',()=>{
  it('prefers the unchanged baseline on equal calibration scores',()=>{
    const f=cacheFixture(),r=compareSortformerCachePolicies(f.manifest,f.arms,'manifest');
    expect(r.selectedCacheUpdateFrames).toBe(31);expect(r.modelOrConfigAutomaticallyPromoted).toBe(false);
  });
  it('rejects the calibration winner when held-out regression worsens instead of choosing another arm',()=>{
    const f=cacheFixture();f.arms[0].variants[0].cases.forEach(c=>c.predicted[0].endMs=c.id[0]==='c'?1000:400);
    const r=compareSortformerCachePolicies(f.manifest,f.arms,'manifest');
    expect(r.selectedCacheUpdateFrames).toBe(24);expect(r.validationPassed).toBe(false);expect(r.deviceAccepted).toBe(false);
  });
  it.each(['weight','geometry','postprocessing','second-parameter','pcm','unapproved-cache'])('rejects %s changes',kind=>{
    const f=cacheFixture(),a=f.arms[0];
    if(kind==='weight')a.profile='sortformer_v2_1_balanced';
    if(kind==='geometry')a.inferenceSettings.fifoFrames=188;
    if(kind==='postprocessing')a.variants[0].activity.onset=.6;
    if(kind==='second-parameter')a.inferenceSettings.silenceThreshold=.3;
    if(kind==='pcm')a.variants[0].cases[0].sha256='wrong';
    if(kind==='unapproved-cache')a.cacheUpdateFrames=46;
    expect(()=>compareSortformerCachePolicies(f.manifest,f.arms,'manifest')).toThrow();
  });
});
