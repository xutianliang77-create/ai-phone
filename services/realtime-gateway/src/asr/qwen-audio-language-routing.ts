import type {QwenAudioSentence} from './qwen-audio-streaming-protocol.js';
import type {DeviceTextLanguageBroker,TextLanguageDecision} from '../connection/device-text-language.js';
import {textForLanguageObservation} from '../connection/text-language-evidence.js';
import {isProtectedSpeakerCut} from '../speaker/speaker-split-protected-surface.js';

type Range={start:number;end:number};
export interface RoutedAudioSentence {id:string;sentence:QwenAudioSentence;decision:TextLanguageDecision}

/** Script changes are a request to inspect bounded clauses, NOT a source-
 * language decision. Only independently confirmed phone observations can route
 * a child. Same-language clauses keep the supplier's complete semantic final. */
export async function routeQwenAudioLanguage(sentence:QwenAudioSentence,id:string,broker:DeviceTextLanguageBroker):Promise<RoutedAudioSentence[]> {
  const ranges=clauseRanges(sentence.text);
  const scripts=ranges.map(r=>scriptSignature(textForLanguageObservation(sentence.text.slice(r.start,r.end))));
  const whole=(decision:TextLanguageDecision)=>[{id,sentence,decision}];
  if(new Set(scripts.filter(Boolean)).size<2){return whole(await broker.identify(id,1,sentence.text));}
  if(ranges.length>8)return whole({status:'unknown',reason:'mixed_unaligned'});
  const decisions=await Promise.all(ranges.map((r,index)=>broker.identify(`${id}.language.${index+1}`,1,sentence.text.slice(r.start,r.end))));
  const first=decisions[0];
  if(first.status==='detected'&&decisions.every(d=>d.status==='detected'&&d.language===first.language)){
    return whole({...first,confidence:Math.min(...decisions.map(d=>d.status==='detected'?d.confidence:0))});
  }
  const groups:Array<Range&{observationIndex:number;decision:TextLanguageDecision}>=[];
  ranges.forEach((range,index)=>{
    const previous=groups.at(-1),decision=decisions[index];
    if(previous?.decision.status==='detected'&&decision.status==='detected'&&previous.decision.language===decision.language){
      previous.end=range.end;previous.decision.confidence=Math.min(previous.decision.confidence,decision.confidence);
    }else groups.push({...range,observationIndex:index,decision:{...decision}});
  });
  const children:QwenAudioSentence[]=[];
  for(const group of groups){
    const child=timedClause(sentence,group);
    if(!child)return whole({status:'unknown',reason:'mixed_unaligned'});
    const previous=children.at(-1);
    if(previous&&previous.endMs!>child.startMs)return whole({status:'unknown',reason:'mixed_unaligned'});
    children.push(child);
  }
  return children.map((child,index)=>({id:`${id}.language.${groups[index].observationIndex+1}`,sentence:child,decision:groups[index].decision}));
}

function clauseRanges(text:string):Range[] {
  const ranges:Range[]=[];let start=0;
  for(const match of text.matchAll(/[。！？!?]|\.(?=\s|$)/gu)){
    const end=match.index!+match[0].length;
    if(isProtectedSpeakerCut(text,end,[]))continue;
    if(text.slice(start,end).trim())ranges.push({start,end});
    start=end;
  }
  if(text.slice(start).trim())ranges.push({start,end:text.length});
  else if(ranges.length)ranges[ranges.length-1].end=text.length;
  return ranges.length?ranges:[{start:0,end:text.length}];
}

function scriptSignature(text:string):string {
  // A kana/han sentence is one script family for this diagnostic, never a
  // heuristic zh/ja label. Technical Latin identifiers have already been masked.
  if(/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))return 'kana';
  if(/\p{Script=Hangul}/u.test(text))return 'hangul';
  const scripts=[/\p{Script=Han}/u,/\p{Script=Latin}/u,/\p{Script=Cyrillic}/u,
    /\p{Script=Arabic}/u,/\p{Script=Devanagari}/u,/\p{Script=Thai}/u,/\p{Script=Hebrew}/u];
  return scripts.map((pattern,index)=>pattern.test(text)?index:'').filter(x=>x!=='').join(',');
}

function timedClause(sentence:QwenAudioSentence,range:Range):QwenAudioSentence|undefined {
  const raw=sentence.text.slice(range.start,range.end),text=raw.trim();
  const start=range.start+raw.length-raw.trimStart().length,end=start+text.length;
  const tokens=sentence.tokenTimings;
  if(!tokens?.length||!text)return;
  const selected=tokens.filter(t=>t.characterStart!==undefined&&t.characterEnd!==undefined&&
    t.characterEnd>start&&t.characterStart<end);
  if(!selected.length)return;
  let covered=start,previousEnd=-1;
  for(const token of selected){
    if(token.characterStart!<start||token.characterEnd!>end||
      sentence.text.slice(token.characterStart,token.characterEnd)!==token.text||
      sentence.text.slice(covered,token.characterStart).trim()||token.startMs<previousEnd)return;
    covered=token.characterEnd!;previousEnd=token.endMs;
  }
  if(sentence.text.slice(covered,end).trim())return;
  return {...sentence,text,startMs:selected[0].startMs,endMs:selected.at(-1)!.endMs,
    tokenTimings:selected.map(token=>({...token,characterStart:token.characterStart!-start,characterEnd:token.characterEnd!-start}))};
}
