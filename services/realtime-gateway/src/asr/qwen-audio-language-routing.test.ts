import {expect,it} from 'vitest';
import type {DeviceTextLanguageRequest} from '@translation/contracts';
import {DeviceTextLanguageBroker} from '../connection/device-text-language.js';
import {routeQwenAudioLanguage} from './qwen-audio-language-routing.js';
import type {QwenAudioSentence} from './qwen-audio-streaming-protocol.js';

function sentence(text:string):QwenAudioSentence {
  return {sentenceId:1,isFinal:true,text,startMs:0,endMs:text.length*100,languageEvidence:'not_reported',
    tokenTimings:Array.from(text).flatMap((c,index)=>c.trim()?[{text:c,startMs:index*100,endMs:(index+1)*100,characterStart:index,characterEnd:index+1}]:[])};
}
function observer(choose:(text:string)=>[string,Record<string,number>]){
  const requests:DeviceTextLanguageRequest[]=[];
  const broker=new DeviceTextLanguageBroker('s',['zh','en','ja','fr'],r=>{
    requests.push(r);const {text,...binding}=r,[dominant,hypotheses]=choose(text);
    queueMicrotask(()=>broker.accept({...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant,hypotheses}));return true;
  });
  return {requests,broker};
}
const pair=(text:string):[string,Record<string,number>]=>/\p{Script=Han}/u.test(text)?['zh-Hans',{'zh-Hans':0.74,'zh-Hant':0.25}]:['en',{en:0.99}];
it('routes the observed Chinese and English complete clauses separately without losing text or guessing timestamps',async()=>{
  const s=sentence('你好，这是在线同传冒烟测试。Hello, this is an online translation test.');
  const t=observer(pair);
  try{
    const result=await routeQwenAudioLanguage(s,'task:1',t.broker);
    expect(result).toHaveLength(2);
    expect(result.map(r=>r.decision)).toEqual([
      {status:'detected',language:'zh',confidence:0.99},{status:'detected',language:'en',confidence:0.99}]);
    expect(result.map(r=>r.sentence.text).join('')).toBe(s.text);
    expect(result[0].sentence.endMs).toBe(s.text.indexOf('Hello')*100);
    expect(result[1].sentence.startMs).toBe(result[0].sentence.endMs);
    expect(result.every(r=>r.sentence.tokenTimings?.every(token=>r.sentence.text.slice(token.characterStart,token.characterEnd)===token.text))).toBe(true);
    expect(t.requests.map(r=>r.segmentId)).toEqual(['task:1.language.1','task:1.language.2']);
  }finally{t.broker.close();}
});
it('keeps the improved single-language long sentence and embedded model identifiers intact',async()=>{
  const t=observer(pair);
  try{
    for(const text of ['今天下午3点，我们会讨论产品计划。会议结束以后，我会整理会议纪要，并在下班前发给大家确认。',
      '我们要测试 Qwen3 ASR、 HiMT2 和 VoxCPM2 的在线模型链路。']){
      const result=await routeQwenAudioLanguage(sentence(text),'task:1',t.broker);
      expect(result).toHaveLength(1);expect(result[0].id).toBe('task:1');
      expect(result[0].sentence.text).toBe(text);expect(result[0].decision).toMatchObject({language:'zh'});
    }
    expect(t.requests).toHaveLength(2);
  }finally{t.broker.close();}
});
it.each(['missing','crossing','overlap'])('does not invent alignment for mixed clauses (%s)',async fault=>{
  const s=sentence('你好，这是中文测试。Hello everyone.');
  if(fault==='missing')delete s.tokenTimings;
  if(fault==='crossing')s.tokenTimings=[{text:s.text,startMs:0,endMs:s.endMs!,characterStart:0,characterEnd:s.text.length}];
  if(fault==='overlap')s.tokenTimings![s.text.indexOf('Hello')].startMs=0;
  const t=observer(pair);
  try{const result=await routeQwenAudioLanguage(s,'task:1',t.broker);
    expect(result).toEqual([{id:'task:1',sentence:s,decision:{status:'unknown',reason:'mixed_unaligned'}}]);
  }finally{t.broker.close();}
});
it('keeps a third language distinct and cannot borrow a neighbor language for a short ambiguous answer',async()=>{
  const t=observer(text=>text.includes('こんにちは')?['ja',{ja:0.99}]:['en',{en:0.6,fr:0.4}]);
  try{
    const result=await routeQwenAudioLanguage(sentence('こんにちは、お元気ですか？Okay.'),'task:1',t.broker);
    expect(result[0].decision).toMatchObject({language:'ja'});
    expect(result[1].decision).toEqual({status:'unknown',reason:'ambiguous'});
    expect(result[1].sentence.text).toBe('Okay.');
  }finally{t.broker.close();}
});
