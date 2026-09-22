import type {TranslationLanguageCode} from "@translation/contracts";
import type {State,Turn} from "./streaming-asr-state.js";

/** Complete the original supplier item even when the product cannot translate
 * its language; this must not poison the socket or settle a second ASR attempt. */
export function completeQwenTurn(s:State,turn:Turn,language:TranslationLanguageCode,automatic:boolean,rate:number){
  if(turn.finalizing||turn.terminal||!turn.ack||!turn.result)return;
  turn.terminal=true;const result=turn.result,item=turn.providerItemId!;
  const start=turn.providerStartSample??turn.event.audioStartSample!,end=turn.providerEndSample??turn.event.audioEndSample!;
  const transport=s.qwenTransport;if(!transport?.sent||transport.terminal)throw Error();
  s.seen.add(item);if(s.seen.size>1024)s.seen.delete(s.seen.values().next().value!);s.lastItem=item;
  if(turn.unsupportedLanguage){
    (s.languageNotices??=[]).push({segmentId:turn.event.segmentId,revision:1,language:turn.unsupportedLanguage,
      ...(turn.previewLanguage?{previewLanguage:turn.previewLanguage}:{})});
  }else{
    s.completed.push({segmentId:turn.event.segmentId,revision:1,isFinal:true,text:result.text,language,
      ...(automatic&&turn.detectedLanguage!==undefined?{automaticLanguageStatus:"detected" as const}:{}),
      timing:{startMs:start/(rate/1000),endMs:end/(rate/1000),source:"estimated"}});
  }
  if(s.turn===turn)s.turn=undefined;
}
