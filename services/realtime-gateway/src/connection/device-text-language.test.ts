import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {isDeviceTextLanguageResult,type DeviceTextLanguageRequest} from '@translation/contracts';
import {DeviceTextLanguageBroker} from './device-text-language.js';
import {textForLanguageObservation} from './text-language-evidence.js';
import {realtimeLogger} from '../metrics/realtime-metrics.js';
const fixture=JSON.parse(readFileSync(new URL('../../../../packages/contracts/fixtures/device-text-language-v1.json',import.meta.url),'utf8'));
const response=(r:DeviceTextLanguageRequest,dominant:string|null='fr',hypotheses:Record<string,number>={fr:0.98,en:0.01})=>{
  const {text,audioRange,...binding}=r;return {...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant,hypotheses};
};
afterEach(()=>vi.useRealTimers());
it('keeps old Apps on the exact old challenge without adding a timeout or fabricating speech evidence',async()=>{
  let request!:DeviceTextLanguageRequest;const send=vi.fn((r:DeviceTextLanguageRequest)=>{request=r;return true;});
  const broker=new DeviceTextLanguageBroker('s',['en'],send,2000,false);
  const range={startSample:0,endSample:1000,sampleRate:16000 as const};
  const p=broker.identify('old',1,'Hello everyone.',range);
  expect(request).not.toHaveProperty('audioRange');broker.accept(response(request,'en',{en:0.99}));
  await expect(p).resolves.toMatchObject({status:'detected',language:'en'});
  await expect(broker.confirmSpeech('old',1,'Hello everyone.',range)).resolves.toBe(true);
  expect(send).toHaveBeenCalledTimes(1);broker.close();
});
it('accepts fully covered negative speech evidence only for the exact nonce/revision/hash/audio range',async()=>{
  let r!:DeviceTextLanguageRequest;const broker=new DeviceTextLanguageBroker('s',['zh','en'],v=>{r=v;return true;});
  const range={startSample:32000,endSample:48000,sampleRate:16000 as const};
  const decision=broker.identify('seg',1,'Can you book a room.',range);
  const e={method:'ios_silero_render_v1',range:{sampleRate:16000,endSample:48000,startSample:32000},
    decision:'non_speech',coveredThroughSample:60000,reason:'no_speech_support'};
  expect(broker.accept({...response(r,'en',{en:0.99}),audioEvidence:{...e,range:{...range,startSample:31000}}})).toBe(false);
  expect(broker.accept({...response(r,'en',{en:0.99}),audioEvidence:{...e,coveredThroughSample:47000}})).toBe(false);
  expect(broker.accept({...response(r,'en',{en:0.99}),audioEvidence:e})).toBe(true);
  await expect(decision).resolves.toEqual({status:'non_speech',reason:'no_speech_support'});
  await expect(broker.confirmSpeech('seg',1,'Can you book a room.',range)).resolves.toBe(false);
  broker.close();await expect(broker.confirmSpeech('seg',1,'Can you book a room.',range)).resolves.toBe(true);
});
it.each(['speech','unknown','missing'])('does not suppress real speech or fabricate negative evidence (%s)',async kind=>{
  let r!:DeviceTextLanguageRequest;const broker=new DeviceTextLanguageBroker('s',['en'],v=>{r=v;return true;});
  const range={startSample:0,endSample:4000,sampleRate:16000 as const};
  const p=broker.confirmSpeech('seg',1,'Okay.',range);
  broker.accept({...response(r,'en',{en:0.99}),...(kind==='missing'?{}:{audioEvidence:{method:'ios_silero_render_v1',range,
    decision:kind,coveredThroughSample:5000,reason:kind==='speech'?'speech_overlap':'uncovered'}})});
  await expect(p).resolves.toBe(true);broker.close();
});
it('accepts the exact shared mobile response contract; rejects extra choice/authority and malformed probabilities',()=>{
  expect(isDeviceTextLanguageResult(fixture.response)).toBe(true);
  for(const patch of [{targetLanguage:'zh'},{hypotheses:{fr:2}},{hypotheses:{fr:0.9,en:0.9}},
    {dominant:'en',hypotheses:{fr:1}},{revision:-1},{evidence:'acoustic'},{textSha256:'x'}]){
    expect(isDeviceTextLanguageResult({...fixture.response,...patch})).toBe(false);
  }
});
it('binds same session, segment, revision, hash, nonce; duplicate replies cannot route again',async()=>{
  let request!:DeviceTextLanguageRequest;
  const broker=new DeviceTextLanguageBroker('session',['zh','en','fr'],r=>{request=r;return true;});
  const decision=broker.identify('sentence-1',1,fixture.request.text);
  expect(request.textSha256).toBe(fixture.request.textSha256);
  for(const patch of [{sessionId:'other'},{segmentId:'other'},{revision:2},{textSha256:'0'.repeat(64)},{requestId:'old'}])expect(broker.accept({...response(request),...patch})).toBe(false);
  expect(broker.accept(response(request))).toBe(true);
  await expect(decision).resolves.toEqual({status:'detected',language:'fr',confidence:0.98});
  expect(broker.accept(response(request))).toBe(false);broker.close();
});
it.each([
  ['Okay.','en',{en:0.99},'detected'],['Hello everyone.','en',{en:0.51,fr:0.49},'ambiguous'],
  ['暂停。','zh-Hans',{'zh-Hans':0.9999983906745911,'zh-Hant':0.0000007201718972282833,ja:0.0000009116975547840411},'detected'],
  ['Merci.','fr',{fr:0.99,en:0.005},'detected'],
  ['暂停。','zh-Hans',{'zh-Hans':0.91,ja:0.09},'ambiguous'],
  ['Si.','es',{es:0.6,it:0.4},'ambiguous'],
  ['这是中文测试。','zh-Hans',{'zh-Hans':0.99},'detected'],
  ['你叫什么名字？','zh-Hans',{'zh-Hans':0.7366148,'zh-Hant':0.2612020,ja:0.002183},'detected'],
  ['我叫天亮。','zh-Hant',{'zh-Hant':0.7371357,'zh-Hans':0.2599954,ja:0.0028689},'detected'],
  ['可。','zh-Hant',{'zh-Hant':0.76081395,'zh-Hans':0.2078113,ja:0.0313747},'ambiguous'],
  ['这里依然不明确。','zh-Hans',{'zh-Hans':0.5,'zh-Hant':0.2,ja:0.3},'ambiguous'],
  ['これは日本語のテストです。','ja',{ja:0.96,'zh-Hans':0.02,'zh-Hant':0.01},'unsupported'],
  ['Buongiorno a tutti.','it',{it:0.99},'unsupported'],
  ['Hello everyone.',null,{},'ambiguous'],
] as const)('retains uncertainty/third language instead of guessing the output pair: %s',async(text,dominant,hypotheses,status)=>{
  let r!:DeviceTextLanguageRequest;const broker=new DeviceTextLanguageBroker('s',['zh','en','fr'],v=>{r=v;return true;});
  const p=broker.identify('seg',1,text);broker.accept(response(r,dominant,{...hypotheses}));
  const value=await p;expect(value.status==='detected'?'detected':value.reason).toBe(status);broker.close();
});
it('routes confident short third-language speech without borrowing the selected pair',async()=>{
  let r!:DeviceTextLanguageRequest;const broker=new DeviceTextLanguageBroker('s',['zh','en','ja'],v=>{r=v;return true;});
  const p=broker.identify('short-ja',1,'はい。');broker.accept(response(r,'ja',{ja:0.995,'zh-Hans':0.005}));
  await expect(p).resolves.toEqual({status:'detected',language:'ja',confidence:0.995});
  const unsupported=broker.identify('short-fr',1,'Merci.');broker.accept(response(r,'fr',{fr:0.99}));
  await expect(unsupported).resolves.toEqual({status:'unknown',reason:'unsupported'});broker.close();
});
it('reuses v1 identifier masking only in the bound observation, without manufacturing a language',async()=>{
  const text='我们要测试 Qwen3 ASR、 HiMT2 和 VoxCPM2 的在线模型链路。';
  const projected=textForLanguageObservation(text);
  expect(projected.length).toBe(text.length);
  expect(projected).toContain('我们要测试');expect(projected).not.toMatch(/Qwen3|ASR|HiMT2|VoxCPM2/);
  expect(textForLanguageObservation('Please review the report.')).toBe('Please review the report.');
  expect(textForLanguageObservation('Bonjour tout le monde.')).toBe('Bonjour tout le monde.');
  let r!:DeviceTextLanguageRequest;
  const broker=new DeviceTextLanguageBroker('s',['zh','en'],v=>{r=v;return true;});
  const decision=broker.identify('terms',1,text);
  expect(r.text).toBe(projected);
  broker.accept(response(r,'zh-Hans',{'zh-Hans':0.98,'zh-Hant':0.01}));
  await expect(decision).resolves.toEqual({status:'detected',language:'zh',confidence:0.99});
  const termsOnly=broker.identify('only',1,'Qwen3 ASR Hy-MT2 VoxCPM2');
  broker.accept(response(r,'en',{en:1}));
  await expect(termsOnly).resolves.toEqual({status:'unknown',reason:'ambiguous'});
  broker.close();
});
it('invalidates an old revision and a disconnected socket; timeout is bounded',async()=>{
  vi.useFakeTimers();const requests:DeviceTextLanguageRequest[]=[];
  const broker=new DeviceTextLanguageBroker('s',['en'],r=>{requests.push(r);return true;},100);
  const old=broker.identify('seg',1,'Hello everyone.'),next=broker.identify('seg',2,'Hello everyone again.');
  await expect(old).resolves.toMatchObject({reason:'stale'});expect(broker.accept(response(requests[0]))).toBe(false);
  await vi.advanceTimersByTimeAsync(101);await expect(next).resolves.toMatchObject({reason:'timeout'});
  const pending=broker.identify('tail',1,'Hello everyone.');broker.close();
  await expect(pending).resolves.toMatchObject({reason:'unavailable'});expect(broker.accept(response(requests.at(-1)!))).toBe(false);
});
it('logs bounded text-free reasons and log failure cannot strand language resolution or End',async()=>{
  vi.stubEnv('PUBLIC_ASR_BOUNDARY_TRACE_ENABLED','true');
  const log=vi.spyOn(realtimeLogger,'info').mockImplementation(()=>{});
  let request!:DeviceTextLanguageRequest;
  const broker=new DeviceTextLanguageBroker('s',['zh','en'],r=>{request=r;return true;});
  try{
    const p=broker.identify('private',1,'PRIVATE customer words.');broker.accept(response(request,'en',{en:0.99}));
    await expect(p).resolves.toMatchObject({status:'detected'});
    expect(log.mock.calls).toHaveLength(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
    expect(log.mock.calls[1][0]).toMatchObject({stage:'language_decision',status:'detected'});
    log.mockImplementation(()=>{throw Error('synthetic_log_failure');});
    const next=broker.identify('next',1,'Hello everyone.');broker.accept(response(request,'en',{en:0.99}));
    await expect(next).resolves.toMatchObject({status:'detected'});
  }finally{broker.close();log.mockRestore();vi.unstubAllEnvs();}
});
