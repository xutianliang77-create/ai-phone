import {afterEach,expect,it,vi} from 'vitest';
import type {DeviceTextLanguageRequest,TranslationLanguageCode} from '@translation/contracts';
import {DeviceTextLanguageBroker} from './device-text-language.js';
import {realtimeLogger} from '../metrics/realtime-metrics.js';

// Exact 0106 phone observation, not a synthetic confidence of 1 for every word.
const good={'zh-Hant':0.5647075772285461,'zh-Hans':0.4111216366291046,ja:0.024170760065317154};
const range={startSample:326080,endSample:335680,sampleRate:16000 as const};
const sources:readonly TranslationLanguageCode[]=['zh','en','fr','ja','es'];
type Options={kind?:string;text?:string;dominant?:string;hypotheses?:Record<string,number>;sources?:readonly TranslationLanguageCode[];supported?:boolean};
async function decide(options:Options={}){
 const {kind='speech',text='好。',dominant='zh-Hant',hypotheses=good,supported=true}=options;
 let request!:DeviceTextLanguageRequest;
 const broker=new DeviceTextLanguageBroker('s',options.sources??sources,r=>{request=r;return true;},50,supported);
 try{
  const p=broker.identify('short',1,text,kind==='no_range'?undefined:range);
  const {text:original,audioRange,...binding}=request;
  const audioEvidence=!supported||['missing','no_range'].includes(kind)?{}:{audioEvidence:{method:'ios_silero_render_v1',range,
   decision:kind==='silence'||kind==='echo'?'non_speech':kind==='partial'?'speech':kind,
   coveredThroughSample:kind==='partial'?range.endSample-1:range.endSample,
   reason:kind==='silence'?'no_speech_support':kind==='echo'?'render_echo':kind==='unknown'?'uncovered':'speech_overlap'}};
  expect(broker.accept({...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant,hypotheses,...audioEvidence})).toBe(true);
  return await p;
 }finally{broker.close();}
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

it('admits the actual 0106 short Chinese result only with positive, fully covered speech',async()=>{
 expect(await decide()).toEqual({status:'detected',language:'zh',confidence:good['zh-Hant']+good['zh-Hans']});
});
it.each(['missing','unknown','no_range','partial'])('retains strict scoring without full positive speech: %s',async kind=>{
 expect(await decide({kind})).toEqual({status:'unknown',reason:'ambiguous'});
 // This also applies to multi-letter short words, not only the single-letter gate.
 expect(await decide({kind,text:'Merci.',dominant:'fr',hypotheses:{fr:0.975,en:0.025}})).toMatchObject({status:'unknown'});
});
it('does not silently relax old clients without speech-evidence capability',async()=>{
 expect(await decide({supported:false})).toMatchObject({status:'unknown'});
 expect(await decide({supported:false,text:'Merci.',dominant:'fr',hypotheses:{fr:0.975,en:0.025}})).toMatchObject({status:'unknown'});
 expect(await decide({supported:false,text:'Merci.',dominant:'fr',hypotheses:{fr:0.99,en:0.01}})).toMatchObject({status:'detected',language:'fr'});
});
it.each(['silence','echo'])('negative physical evidence takes precedence over text confidence: %s',async kind=>{
 expect(await decide({kind})).toMatchObject({status:'non_speech'});
 expect(await decide({kind,text:'Merci.',dominant:'fr',hypotheses:{fr:1}})).toMatchObject({status:'non_speech'});
});
it.each([
 ['fr','Oui.'],['en','Sure.'],['es','Sí.'],['ja','はい。'],
] as const)('bounded speech scoring is language/provider neutral: %s',async(language,text)=>{
 expect(await decide({text,dominant:language,hypotheses:{[language]:0.975,zh:0.025}})).toMatchObject({status:'detected',language});
 expect(await decide({text,dominant:language,hypotheses:{[language]:0.975,zh:0.025},sources:['zh']})).toEqual({status:'unknown',reason:'unsupported'});
});
it.each([0.97,0.979999,0.98,1])('accepts speech-backed scores at/above the bounded floor: %s',async p=>{
 expect(await decide({text:'Oui.',dominant:'fr',hypotheses:{fr:p,en:1-p}})).toMatchObject({status:'detected',language:'fr',confidence:p});
});
it.each([0.969999,0.91,0.80,0.60])('does not convert real speech into language certainty below the floor: %s',async p=>{
 expect(await decide({text:'Oui.',dominant:'fr',hypotheses:{fr:p,en:1-p}})).toEqual({status:'unknown',reason:'ambiguous'});
});
it('keeps the previous quiet-tail score rejected, even in the positive-speech arm',async()=>{
 expect(await decide({text:'可。',dominant:'zh-Hant',hypotheses:{'zh-Hant':0.76081395,'zh-Hans':0.2078113,ja:0.0313747}})).toMatchObject({status:'unknown'});
});
it.each(['123','。','ASR','Qwen3'])('does not give identifiers or punctuation a language: %s',async text=>{
 expect(await decide({text,dominant:'en',hypotheses:{en:1}})).toMatchObject({status:'unknown'});
});
it('retains the long-utterance policy instead of tightening all speech to the short floor',async()=>{
 expect(await decide({text:'Bonjour tout le monde.',dominant:'fr',hypotheses:{fr:0.90,en:0.10}})).toMatchObject({status:'detected',language:'fr'});
});
it('does not reuse a previous language, stale reply, changed nonce or mismatched audio range',async()=>{
 const requests:DeviceTextLanguageRequest[]=[];
 const broker=new DeviceTextLanguageBroker('bound',sources,r=>{requests.push(r);return true;},50);
 const reply=(r:DeviceTextLanguageRequest)=>{
  const {text,audioRange,...binding}=r;
  return {...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'zh-Hant',hypotheses:good,
   audioEvidence:{method:'ios_silero_render_v1',range,decision:'speech',reason:'speech_overlap',coveredThroughSample:range.endSample}};
 };
 try{
  const old=broker.identify('same',1,'好。',range),fresh=broker.identify('same',2,'好。',range);
  await expect(old).resolves.toMatchObject({reason:'stale'});expect(broker.accept(reply(requests[0]))).toBe(false);
  const response=reply(requests[1]);
  for(const patch of [{sessionId:'other'},{segmentId:'other'},{revision:1},{requestId:'other'},{textSha256:'0'.repeat(64)},
   {audioEvidence:{...response.audioEvidence,range:{...range,startSample:range.startSample-1}}}])expect(broker.accept({...response,...patch})).toBe(false);
  expect(broker.accept(response)).toBe(true);await expect(fresh).resolves.toMatchObject({status:'detected',language:'zh'});
  expect(broker.accept(response)).toBe(false);
  const unknown=broker.identify('next',1,'Hi.',range),last=requests.at(-1)!;
  expect(broker.accept({...reply(last),dominant:'en',hypotheses:{en:0.803,fr:0.1}})).toBe(true);
  await expect(unknown).resolves.toMatchObject({status:'unknown'});
 }finally{broker.close();}
});
it('logs the active score policy without transcript or audio content',async()=>{
 vi.stubEnv('PUBLIC_ASR_BOUNDARY_TRACE_ENABLED','true');
 const log=vi.spyOn(realtimeLogger,'info').mockImplementation(()=>{});
 await decide();
 expect(log.mock.calls.map(c=>c[0])).toContainEqual(expect.objectContaining({stage:'language_observation',
  fullyCoveredSpeech:true,minimumProbability:0.97,minimumMargin:0.8}));
 expect(JSON.stringify(log.mock.calls)).not.toContain('好。');
 log.mockClear();await decide({kind:'unknown'});
 expect(log.mock.calls.map(c=>c[0])).toContainEqual(expect.objectContaining({stage:'language_observation',
  fullyCoveredSpeech:false,minimumProbability:0.98,minimumMargin:0.8}));
});
