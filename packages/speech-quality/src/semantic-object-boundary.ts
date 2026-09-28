/** Pair-wise clause evidence. No supplier/model names or fixture sentences.
 * A nominal list can extend an explicit object, but not an independent clause.
 * Only fully recognized nominal structures count as positive evidence. An
 * unclassified word string is not a noun merely because no verb was found. */
export function isObjectEnumerationContinuation(previous:string,current:string,language:string) {
  const left=body(previous),right=body(current);
  if(!left||!right||/[!?！？]$/u.test(previous.trim())||/[!?！？]$/u.test(current.trim()))return false;
  if(language==="zh"){
    const object=left.match(/^.*(?:包括|包含|分别是|依次是|例如|比如|需要|准备|采购|购买|检查|测试|验证|使用|部署|安装|选择|支持|采用|连接|接入|评估|对比|比较|处理|涉及|介绍|提供|更换|发送|接收|分配|记录|讨论)\s*([^，。！？;；:：]+)$/u)?.[1];
    return !!object&&nominalParts(object,"zh").every(isChineseNominal)&&isNominalList(right,"zh");
  }
  if(language==="en"){
    const object=left.match(/\b(?:include[sd]?|including|need(?:s|ed)?|require[sd]?|bring|brought|buy|bought|check(?:s|ed)?|test(?:s|ed)?|use[sd]?|deploy(?:s|ed)?|install(?:s|ed)?|choose|chose|select(?:s|ed)?|support(?:s|ed)?|compare[sd]?|provide[sd]?|send|sent|receive[sd]?)\s+([^.!?;:]+)$/iu)?.[1];
    return !!object&&nominalParts(object,"en").every(isEnglishNominal)&&isNominalList(right,"en");
  }
  return false;
}

export function semanticContinuationPunctuation(previous:string,current:string,language:string) {
  return language==="zh"?(isObjectEnumerationContinuation(previous,current,language)?"、":"，"):",";
}

function body(value:string){return value.trim().replace(/[.。]+$/u,"").trim();}
function nominalParts(value:string,language:"zh"|"en") {
  return value.split(language==="zh"?/(?:、|以及|和|与|及)/u:/\s+(?:and|or)\s+|,\s*/iu).map(x=>x.trim());
}
function isNominalList(value:string,language:"zh"|"en") {
  const parts=nominalParts(value,language);
  const nominal=language==="zh"?isChineseNominal:isEnglishNominal;
  return parts.length>=2&&parts.every(part=>nominal(part.trim()));
}

function isChineseNominal(value:string) {
  if(technicalLabel(value)||chineseNounPhrase.test(value))return true;
  const property=value.split("的");
  return property.length===2&&(technicalLabel(property[0].trim())||chineseNounPhrase.test(property[0].trim()))&&
    chineseNounPhrase.test(property[1].trim());
}

function isEnglishNominal(value:string) {
  const item=value.trim().replace(/^(?:the|a|an|some)\s+/iu,"");
  return technicalLabel(item)||englishNounPhrase.test(item);
}

// Bounded grammatical categories, not vendor names or an open-ended predicate
// deny-list. Matching consumes the entire phrase; 状态正常 is not 状态.
const chineseNounPhrase=/^(?:(?:在线|离线|本地|云端|端侧|公共|私有|实时|历史|系统|用户|音频|视频|语音|模型|翻译|会议|人工)){0,2}(?:日志|缓存|数据库|状态|配置|参数|文件|目录|记录|数据|模型|链路|模块|接口|结果|方案|设备|识别|录入|格式|编号|名称|版本|纪要)$/u;
const englishNounPhrase=/^(?:(?:online|offline|local|cloud|public|private|realtime|historical|system|user|audio|video|speech|model|translation|meeting)\s+){0,2}(?:logs?|cache|database|state|configuration|parameters?|files?|records?|data|models?|pipeline|modules?|interface|results?|devices?|format|version|minutes)$/iu;
function technicalLabel(value:string) {
  // Classify only the existing acronym vocabulary when ASR spells its letters.
  // Keep the original transcript unchanged; never fill a missing name/version.
  value=value.replace(/\b(?:[A-Z][ \t]+){1,3}[A-Z]\b/gu,word=>{
    const compact=word.replace(/[ \t]+/gu,"");
    return /^(?:ASR|TTS|MT|LLM|OCR|VAD|API|GPU|CPU)$/u.test(compact)?compact:word;
  });
  // Require an acronym or a versioned identifier, not arbitrary Title Case
  // followed by ASR/TTS (which can also be a command such as Reboot ASR).
  if(/^(?:ASR|TTS|MT|LLM|OCR|VAD|API|GPU|CPU)$/u.test(value))return true;
  if(/^[A-Za-z][A-Za-z0-9._/-]*[0-9][A-Za-z0-9._/-]*(?:\s+(?:ASR|TTS|MT|LLM|OCR|VAD|API|GPU|CPU))?$/u.test(value))return true;
  return /^[A-Z][A-Za-z0-9_-]*\s+(?:Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|[0-9]+)\s+(?:ASR|TTS|MT|LLM|OCR|VAD|API|GPU|CPU)$/u.test(value);
}
