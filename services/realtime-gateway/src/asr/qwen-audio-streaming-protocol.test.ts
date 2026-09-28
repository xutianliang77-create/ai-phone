import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {qwenAudioRunTask,qwenAudioFinishTask,decodeQwenAudioEvent,qwenAudioUsage,QwenAudioCumulativeUsage} from './qwen-audio-streaming-protocol.js';
const fixture=JSON.parse(readFileSync(new URL('../../../../packages/contracts/fixtures/qwen-audio-streaming-wire-20260928.json',import.meta.url),'utf8'));
const taskId=fixture.taskId as string;
const decode=(e:unknown)=>decodeQwenAudioEvent(e,taskId,448000,16000);
const final=()=>structuredClone(fixture.events.find((e:any)=>e.header.event==='result-generated'&&e.payload.output.sentence.sentence_end));
describe('selected Qwen Audio streaming contract, no automatic route enabled',()=>{
  it('constructs a task request without old realtime fields or a fixed automatic language',()=>{
    const request=qwenAudioRunTask({taskId,model:fixture.model,sampleRate:16000,semanticPunctuation:true,heartbeat:true,vocabulary:{'Qwen3 ASR':4}});
    expect(request.header).toEqual({action:'run-task',task_id:taskId,streaming:'duplex'});
    expect(request.payload.parameters).toMatchObject({vocabulary:{'Qwen3 ASR':4},semantic_punctuation_enabled:true,heartbeat:true});
    expect(request.payload.parameters).not.toHaveProperty('language_hints');expect(request).not.toHaveProperty('session');
    expect(qwenAudioFinishTask(taskId).header.action).toBe('finish-task');
  });
  it.each([{hints:['zh','zh']},{hints:['unknown']},{hints:['zh','en','ja','fr','de']}])('rejects invalid or silently truncated language hints $hints',({hints})=>{
    expect(()=>qwenAudioRunTask({taskId,model:fixture.model,sampleRate:16000,semanticPunctuation:false,heartbeat:true,languageHints:hints})).toThrow();
  });
  it.each([{'secret\nword':4},{'word':50},{'':4}])('rejects unsupported vocabulary %j',vocabulary=>{
    expect(()=>qwenAudioRunTask({taskId,model:fixture.model,sampleRate:16000,semanticPunctuation:true,heartbeat:true,vocabulary})).toThrow();
  });
  it('decodes the entire real wire and preserves absence of language evidence',()=>{
    const decoded=fixture.events.map(decode),results=decoded.filter((e:any)=>e.kind==='result'&&e.sentence.isFinal);
    expect(decoded[0]).toEqual({kind:'started'});expect(decoded.at(-1).kind).toBe('finished');
    expect(results).toHaveLength(4);expect(results.every((e:any)=>e.sentence.languageEvidence==='not_reported')).toBe(true);
    expect(results.every((e:any)=>e.sentence.tokenTimings?.length>0)).toBe(true);
    expect(results.map((e:any)=>e.sentence.text)).toEqual([
      'The meeting starts at three. Please bring the project report. ',
      '会議は三時に始まります。資料を持ってきてください。',
      'La réunion commence à trois heures. Apportez le rapport du projet. ',
      '会议下午3点开始，请带上项目报告。']);
    expect(results.every((e:any)=>!('language' in e.sentence))).toBe(true);
  });
  it('does not add repeated or duplicated cumulative usage snapshots',()=>{
    const usage=new QwenAudioCumulativeUsage();for(const e of fixture.events)usage.observe(e.payload.usage);
    expect(usage.latest()).toEqual({promptTokens:686,completionTokens:50,totalTokens:736,audioSeconds:25});
    usage.observe({input_tokens:686,output_tokens:50,total_tokens:736,duration:25});
    expect(usage.latest()?.totalTokens).toBe(736);
    expect(()=>usage.observe({input_tokens:100,output_tokens:10,total_tokens:110})).toThrow('regressed');
    usage.observe({duration:25});expect(usage.latest()).toEqual({audioSeconds:25});
    expect(()=>usage.observe({input_tokens:100,output_tokens:10,total_tokens:110})).toThrow('regressed');
    expect(qwenAudioUsage(undefined)).toBeUndefined();expect(qwenAudioUsage({duration:0})).toEqual({audioSeconds:0});
    expect(()=>qwenAudioUsage({input_tokens:1,output_tokens:2,total_tokens:4})).toThrow('inconsistent');
  });
  it('keeps declared fixed language and heartbeat separate from source-language evidence',()=>{
    const request=qwenAudioRunTask({taskId,model:fixture.model,sampleRate:16000,semanticPunctuation:false,heartbeat:true,languageHints:['ja']});
    expect(request.payload.parameters.language_hints).toEqual(['ja']);
    const event={header:{event:'result-generated',task_id:taskId},payload:{output:{sentence:{sentence_id:0,heartbeat:true,text:'',sentence_end:false}}}};
    expect(decode(event)).toEqual({kind:'heartbeat'});
    expect(()=>decode({...event,payload:{output:{sentence:{...event.payload.output.sentence,text:'unexpected speech'}}}})).toThrow('heartbeat_invalid');
  });
  it('does not fabricate token alignment when the provider words disagree',()=>{
    const event=final();event.payload.output.sentence.words[0].text='different';
    const result=decode(event);expect(result.kind).toBe('result');
    if(result.kind==='result'){expect(result.sentence.text).toBe(final().payload.output.sentence.text);expect(result.sentence.tokenTimings).toBeUndefined();}
  });
  it('retains exact token times and character offsets through whitespace-only sentence formatting',()=>{
    const event=final(),s=event.payload.output.sentence;
    s.text='  你好。 Hello everyone.  ';s.begin_time=0;s.end_time=3000;
    s.words=[{text:'你好',punctuation:'。',begin_time:0,end_time:1000,fixed:true},
      {text:'Hello ',punctuation:'',begin_time:1200,end_time:2000,fixed:true},
      {text:'everyone',punctuation:'. ',begin_time:2100,end_time:3000,fixed:true}];
    const result=decode(event);
    expect(result.kind).toBe('result');
    if(result.kind==='result')expect(result.sentence.tokenTimings).toEqual([
      {text:'你好。',characterStart:2,characterEnd:5,startMs:0,endMs:1000},
      {text:'Hello',characterStart:6,characterEnd:11,startMs:1200,endMs:2000},
      {text:'everyone.',characterStart:12,characterEnd:21,startMs:2100,endMs:3000}]);
    s.words[2].punctuation='?';
    const mismatch=decode(event);
    if(mismatch.kind==='result')expect(mismatch.sentence.tokenTimings).toBeUndefined();
  });
  it.each(['task','time','word','usage','error'])('rejects malformed %s without inventing source language',kind=>{
    const event=final();if(kind==='task')event.header.task_id='other';
    if(kind==='time')event.payload.output.sentence.end_time=999999;
    if(kind==='word')event.payload.output.sentence.words[0].begin_time=-1;
    if(kind==='usage')event.payload.usage.total_tokens=-1;
    if(kind==='error'){event.header.event='task-failed';event.header.error_message='PRIVATE_PROVIDER_DETAIL';}
    expect(()=>decode(event)).toThrow();
    try{decode(event);}catch(e){expect(String(e)).not.toContain('PRIVATE_PROVIDER_DETAIL');}
  });
});
