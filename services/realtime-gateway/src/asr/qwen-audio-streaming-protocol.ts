import type {AsrTokenTimingDto,PublicModelAttemptEvent} from '@translation/contracts';
import {isAsrTokenTimings} from '@translation/contracts';

type Usage=NonNullable<NonNullable<PublicModelAttemptEvent['metadata']>['usage']>;
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
const integer=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v);
const taskKey=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const languages=new Set('zh en ja ko vi th id ms tl hi ar fr de es pt ru it nl sv da fi no el pl cs hu ro bg hr sk'.split(' '));
const fail=(code:string):never=>{throw new Error(code);};

/** New wire contract only. It is NOT registered as an automatic-language
 * public adapter until the missing per-sentence language decision is wired. */
export function qwenAudioRunTask(input:{taskId:string;model:string;sampleRate:16000|24000;
  semanticPunctuation:boolean;heartbeat:boolean;languageHints?:readonly string[];
  vocabulary?:Readonly<Record<string,number>>}) {
  if(!taskKey(input.taskId)||!input.model||!/^[a-zA-Z0-9_.-]{1,240}$/.test(input.model)||
    ![16000,24000].includes(input.sampleRate)||typeof input.semanticPunctuation!=='boolean'||typeof input.heartbeat!=='boolean')fail('qwen_audio_request_invalid');
  const hints=input.languageHints;
  if(hints!==undefined&&(!Array.isArray(hints)||hints.length<1||hints.length>4||new Set(hints).size!==hints.length||hints.some(x=>!languages.has(x))))fail('qwen_audio_languages_invalid');
  if(input.vocabulary!==undefined&&(!record(input.vocabulary)||Object.keys(input.vocabulary).length>120||Object.entries(input.vocabulary).some(([word,weight])=>
    !word.trim()||word!==word.trim()||word.length>120||/[\u0000-\u001f\u007f]/u.test(word)||!Number.isInteger(weight)||weight<1||weight>5)))fail('qwen_audio_vocabulary_invalid');
  return {header:{action:'run-task',task_id:input.taskId,streaming:'duplex'},payload:{task_group:'audio',task:'asr',function:'recognition',model:input.model,
    parameters:{format:'pcm',sample_rate:input.sampleRate,semantic_punctuation_enabled:input.semanticPunctuation,heartbeat:input.heartbeat,
      ...(hints?{language_hints:[...hints]}:{}),...(input.vocabulary?{vocabulary:{...input.vocabulary}}:{})},input:{}}};
}
export function qwenAudioFinishTask(taskId:string){
  if(!taskKey(taskId))fail('qwen_audio_task_invalid');
  return {header:{action:'finish-task',task_id:taskId,streaming:'duplex'},payload:{input:{}}};
}

export function qwenAudioUsage(value:unknown):Usage|undefined {
  if(value===undefined||value===null)return;
  if(!record(value))return fail('qwen_audio_usage_invalid');
  const usage:Usage={};
  for(const[wire,key]of [['input_tokens','promptTokens'],['output_tokens','completionTokens'],['total_tokens','totalTokens']] as const){
    if(value[wire]!==undefined){if(!integer(value[wire]))fail('qwen_audio_usage_invalid');usage[key]=value[wire];}
  }
  if(value.duration!==undefined){if(!finite(value.duration))fail('qwen_audio_usage_invalid');usage.audioSeconds=value.duration;}
  if(usage.promptTokens!==undefined&&usage.completionTokens!==undefined&&usage.totalTokens!==undefined&&
    usage.promptTokens+usage.completionTokens!==usage.totalTokens)fail('qwen_audio_usage_inconsistent');
  return Object.keys(usage).length?usage:undefined;
}

/** Supplier samples are cumulative task snapshots. Never sum repeated final
 * reports or the duplicate nested payload.output.usage view. Missing != zero. */
export class QwenAudioCumulativeUsage {
  private value?:Usage;
  private highWater:Usage={};
  observe(value:unknown) {
    const next=qwenAudioUsage(value);if(!next)return;
    for(const key of ['promptTokens','completionTokens','totalTokens','audioSeconds'] as const){
      const previous=this.highWater[key];if(previous!==undefined&&next[key]!==undefined&&next[key]!<previous)fail('qwen_audio_usage_regressed');
    }
    Object.assign(this.highWater,next);this.value=structuredClone(next);return structuredClone(next);
  }
  latest(){return this.value&&structuredClone(this.value);}
}

export interface QwenAudioSentence {
  sentenceId:number;text:string;isFinal:boolean;startMs:number;endMs?:number;
  tokenTimings?:AsrTokenTimingDto[];
  /** Deliberately not a provider-confirmed language. No default zh/en. */
  languageEvidence:'not_reported';
}
export type QwenAudioEvent={kind:'started'}|{kind:'finished';usage?:Usage}|{kind:'heartbeat';usage?:Usage}|
  {kind:'result';sentence:QwenAudioSentence;usage?:Usage};

export function decodeQwenAudioEvent(value:unknown,taskId:string,uploadedSamples:number,rate:16000|24000):QwenAudioEvent {
  if(!taskKey(taskId)||!integer(uploadedSamples)||![16000,24000].includes(rate)||!record(value)||!record(value.header)||value.header.task_id!==taskId||!record(value.payload))fail('qwen_audio_event_invalid');
  const e=value as Record<string,any>;
  if(e.header.event==='task-failed')fail('qwen_audio_task_failed'); // Provider messages may contain private data.
  if(e.header.event==='task-started')return {kind:'started'};
  const usage=qwenAudioUsage(e.payload.usage);
  if(e.header.event==='task-finished')return {kind:'finished',...(usage?{usage}:{})};
  if(e.header.event!=='result-generated'||!record(e.payload.output)||!record(e.payload.output.sentence))fail('qwen_audio_event_invalid');
  const s=e.payload.output.sentence;
  if(s.heartbeat===true){
    if(s.sentence_id!==0||s.text!==undefined&&s.text!==''||s.sentence_end===true)fail('qwen_audio_heartbeat_invalid');
    return {kind:'heartbeat',...(usage?{usage}:{})};
  }
  if(s.heartbeat!==undefined&&s.heartbeat!==false||!integer(s.sentence_id)||s.sentence_id<1||typeof s.text!=='string'||s.text.length>16000||
    typeof s.sentence_end!=='boolean'||!finite(s.begin_time)||s.begin_time>uploadedSamples/rate*1000+40||
    s.end_time!==undefined&&s.end_time!==null&&(!finite(s.end_time)||s.end_time<s.begin_time||s.end_time>uploadedSamples/rate*1000+40)||
    s.sentence_end&&(s.end_time===undefined||s.end_time===null))fail('qwen_audio_sentence_invalid');
  if(s.words!==undefined&&(!Array.isArray(s.words)||s.words.length>2048))fail('qwen_audio_words_invalid');
  const tokenTimings=s.sentence_end?finalWordTimings(s):undefined;
  return {kind:'result',sentence:{sentenceId:s.sentence_id,text:s.text,isFinal:s.sentence_end,startMs:s.begin_time,
    ...(finite(s.end_time)?{endMs:s.end_time}:{}),...(tokenTimings?{tokenTimings}:{}),languageEvidence:'not_reported'},...(usage?{usage}:{})};
}

function finalWordTimings(s:Record<string,any>):AsrTokenTimingDto[]|undefined {
  if(!s.words?.length)return;
  const tokens:AsrTokenTimingDto[]=[];let at=0;
  for(const word of s.words){
    if(!record(word)||typeof word.text!=='string'||word.text.length>200||word.punctuation!==undefined&&typeof word.punctuation!=='string'||
      !finite(word.begin_time)||!finite(word.end_time)||word.end_time<word.begin_time||word.begin_time<s.begin_time||word.end_time>s.end_time||
      word.fixed!==undefined&&typeof word.fixed!=='boolean')fail('qwen_audio_words_invalid');
    if(word.fixed===false)return; // Unstable timing is not authoritative.
    const text=word.text+(word.punctuation??'');
    if(!s.text.startsWith(text,at))return; // Preserve text without invented alignment.
    if(text.trim())tokens.push({text,startMs:word.begin_time,endMs:word.end_time,characterStart:at,characterEnd:at+text.length});
    at+=text.length;
  }
  return at===s.text.length&&isAsrTokenTimings(tokens)?tokens:undefined;
}
