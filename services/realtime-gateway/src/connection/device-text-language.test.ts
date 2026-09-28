import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {isDeviceTextLanguageResult,type DeviceTextLanguageRequest} from '@translation/contracts';
import {DeviceTextLanguageBroker} from './device-text-language.js';
const fixture=JSON.parse(readFileSync(new URL('../../../../packages/contracts/fixtures/device-text-language-v1.json',import.meta.url),'utf8'));
const response=(r:DeviceTextLanguageRequest,dominant:string|null='fr',hypotheses:Record<string,number>={fr:0.98,en:0.01})=>{
  const {text,...binding}=r;return {...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant,hypotheses};
};
afterEach(()=>vi.useRealTimers());
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
  ['Okay.','en',{en:0.99},'ambiguous'],['Hello everyone.','en',{en:0.51,fr:0.49},'ambiguous'],
  ['这是中文测试。','zh-Hans',{'zh-Hans':0.99},'detected'],
  ['Buongiorno a tutti.','it',{it:0.99},'unsupported'],
  ['Hello everyone.',null,{},'ambiguous'],
] as const)('retains uncertainty/third language instead of guessing the output pair: %s',async(text,dominant,hypotheses,status)=>{
  let r!:DeviceTextLanguageRequest;const broker=new DeviceTextLanguageBroker('s',['zh','en','fr'],v=>{r=v;return true;});
  const p=broker.identify('seg',1,text);broker.accept(response(r,dominant,{...hypotheses}));
  const value=await p;expect(value.status==='detected'?'detected':value.reason).toBe(status);broker.close();
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
