import {it,expect} from 'vitest';
import type {DeviceTextLanguageRequest,TranslationLanguageCode} from '@translation/contracts';
import {DeviceTextLanguageBroker} from './device-text-language.js';
const range={startSample:485600,endSample:495200,sampleRate:16000 as const};
async function decide(text:string,kind='speech',language='zh-Hans',hypotheses:Record<string,number>={'zh-Hans':1},sources:readonly TranslationLanguageCode[]=['zh','en','ja'],covered=range.endSample){
  let r!:DeviceTextLanguageRequest;
  const broker=new DeviceTextLanguageBroker('session',sources,event=>{r=event;return true;},100);
  try{
    const decision=broker.identify('segment',1,text,kind==='no_range'?undefined:range);
    const {text:ignored,audioRange,...binding}=r;
    const audioEvidence=['missing','no_range'].includes(kind)?{}:{audioEvidence:{method:'ios_silero_render_v1',range,
      decision:kind==='echo'||kind==='silence'?'non_speech':kind,
      reason:kind==='speech'?'speech_overlap':kind==='echo'?'render_echo':kind==='silence'?'no_speech_support':'uncovered',coveredThroughSample:covered}};
    expect(broker.accept({...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:language,hypotheses,...audioEvidence})).toBe(true);
    return await decision;
  }finally{broker.close();}
}
it.each(['说。','是。','好。'])('accepts independently confident single-character speech with exact positive audio evidence: %s',async text=>{
  expect(await decide(text)).toEqual({status:'detected',language:'zh',confidence:1});
});
it.each(['missing','unknown','no_range'])('never treats missing/unknown speech evidence as permission for a single character: %s',async kind=>{
  expect(await decide('说。',kind)).toEqual({status:'unknown',reason:'ambiguous'});
});
it('requires audio coverage through the bound range, not merely an early positive frame',async()=>{
  expect(await decide('说。','speech','zh-Hans',{'zh-Hans':1},['zh'],range.endSample-1)).toMatchObject({status:'unknown'});
});
it.each(['echo','silence'])('keeps confirmed %s out of translation even with a confident language result',async kind=>{
  expect(await decide('说。',kind)).toMatchObject({status:'non_speech'});
});
it('does not assume a selected Chinese/English pair is the source of third-language speech',async()=>{
  expect(await decide('え。','speech','ja',{ja:0.995,'zh-Hans':0.005})).toMatchObject({status:'detected',language:'ja'});
  expect(await decide('え。','speech','ja',{ja:0.995,'zh-Hans':0.005},['zh','en'])).toEqual({status:'unknown',reason:'unsupported'});
});
it('keeps the original short-language probability/margin and identifier protection',async()=>{
  expect(await decide('可。','speech','zh-Hant',{'zh-Hant':0.76081395,'zh-Hans':0.2078113,ja:0.0313747})).toMatchObject({status:'unknown'});
  for(const text of ['123','。','ASR'])expect(await decide(text)).toMatchObject({status:'unknown'});
});
