import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {knownIOSSpeakerCandidate} from './verify_ios_speaker_model.mjs';
const read=name=>JSON.parse(readFileSync(new URL(`../../release/public/1.1.0/${name}`,import.meta.url),'utf8'));
describe('speaker candidate hashes come from frozen source, not a supplied manifest',()=>{
  it('retains Fastest and recognizes Balanced as candidate-only',()=>{
    expect(knownIOSSpeakerCandidate(read('ios-speaker-model-candidate.json')).bytes).toBe(240564360);
    expect(knownIOSSpeakerCandidate(read('ios-speaker-balanced-candidate.json'))).toMatchObject({bytes:246280141,candidateOnly:true,enabledByDefault:false});
  });
  it.each(['hash','revision','shape','profile','default'])('rejects forged %s',field=>{
    const m=read('ios-speaker-balanced-candidate.json');
    if(field==='hash')m.files[0].sha256='0'.repeat(64);
    if(field==='revision')m.revision='main';
    if(field==='shape')m.inputShapes.fifo='[1, 40, 512]';
    if(field==='profile')m.id='sortformer_v2_1_fastest';
    if(field==='default')m.enabledByDefault=true;
    expect(()=>knownIOSSpeakerCandidate(m)).toThrow();
  });
});
