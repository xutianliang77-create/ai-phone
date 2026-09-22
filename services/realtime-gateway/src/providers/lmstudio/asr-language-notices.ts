import type {ServerRealtimeEvent} from "@translation/contracts";
import type {AsrProvider} from "../../asr/asr-provider.js";
import type {RealtimeProviderSession} from "../realtime-provider.js";

/** Reuse the existing nonfatal segment-failure contract, without fabricating a
 * supported source language or sending an unauthorized MT/TTS request. */
export function* asrLanguageNotices(asr:AsrProvider,session:RealtimeProviderSession,provider:string):Generator<ServerRealtimeEvent>{
  for(const notice of asr.takeLanguageNotices?.(session.sessionId)??[]){
    if(notice.previewLanguage)yield {type:"transcript.final",sessionId:session.sessionId,segmentId:notice.segmentId,
      revision:notice.revision,text:"",language:notice.previewLanguage};
    yield {type:"translation.failed",sessionId:session.sessionId,segmentId:notice.segmentId,revision:notice.revision,
      language:session.targetLanguage,stage:"translation",provider,retryable:false,
      message:`已识别到当前版本暂未接入的语种（${notice.language}），此段未翻译；会话继续。`};
  }
}
