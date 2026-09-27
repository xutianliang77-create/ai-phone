/** Pair-wise clause evidence. No supplier/model names or fixture sentences.
 * A nominal list can extend an explicit object, but not an independent clause.
 * This is deliberately bounded syntax, not a claim of general NLP parsing. */
export function isObjectEnumerationContinuation(previous:string,current:string,language:string) {
  const left=body(previous),right=body(current);
  if(!left||!right||/[!?！？]$/u.test(previous.trim())||/[!?！？]$/u.test(current.trim()))return false;
  if(language==="zh"){
    const object=left.match(/(?:包括|包含|分别是|依次是|例如|比如|需要|准备|采购|购买|检查|测试|验证|使用|部署|安装|选择|支持|采用|连接|接入|评估|对比|比较|处理|涉及|介绍|提供|更换|发送|接收|分配|记录|讨论)\s*([^，。！？;；:：]+)$/u)?.[1];
    return !!object&&isChineseNominal(object)&&isNominalList(right,"zh");
  }
  if(language==="en"){
    const object=left.match(/\b(?:include[sd]?|including|need(?:s|ed)?|require[sd]?|bring|brought|buy|bought|check(?:s|ed)?|test(?:s|ed)?|use[sd]?|deploy(?:s|ed)?|install(?:s|ed)?|choose|chose|select(?:s|ed)?|support(?:s|ed)?|compare[sd]?|provide[sd]?|send|sent|receive[sd]?)\s+([^.!?;:]+)$/iu)?.[1];
    return !!object&&isEnglishNominal(object)&&isNominalList(right,"en");
  }
  return false;
}

export function semanticContinuationPunctuation(previous:string,current:string,language:string) {
  return language==="zh"?(isObjectEnumerationContinuation(previous,current,language)?"、":"，"):",";
}

function body(value:string){return value.trim().replace(/[.。]+$/u,"").trim();}
function isNominalList(value:string,language:"zh"|"en") {
  const parts=value.split(language==="zh"?/(?:、|以及|和|与|及)/u:/\s+(?:and|or)\s+|,\s*/iu);
  const nominal=language==="zh"?isChineseNominal:isEnglishNominal;
  return parts.length>=2&&parts.every(part=>nominal(part.trim()));
}

function isChineseNominal(value:string) {
  if(!value||/[，。！？!?;；:：]/u.test(value))return false;
  // Subject/tense/predicate evidence closes a clause. Do not stitch complete
  // statements merely because they contain 和/与. Technical labels stay opaque.
  if(/^(?:我|你|您|他|她|它|咱|大家|今天|明天|昨天|现在|这里|那里|这时|那时)/u.test(value))return false;
  return !/(?:已经|正在|将要|将会|应该|必须|不能|不会|可以|需要|没有|不是|并非|决定|开始|结束|停止|售完|卖完|出发|完成了|发生了|出了|是|有|很|非常|十分)|[了着过吧呢吗]$/u.test(value);
}

function isEnglishNominal(value:string) {
  if(!value||/[.!?;:，。！？；：]/u.test(value))return false;
  if(/^(?:I|you|we|he|she|it|they|there|here|today|tomorrow|yesterday)\b/iu.test(value))return false;
  if(/\b(?:am|is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|should|must|may|might|shall|need|needs|please|start|starts|stop|stops|works|fails|failed|finished|arrived|costs?|looks?|seems?|remains?|becomes?|tastes?)\b/iu.test(value))return false;
  // Do not assume every verb-free-looking multiword string is a noun phrase.
  // Single items and technical/proper-name surfaces provide bounded evidence;
  // uncertain ordinary multiword fragments retain their original boundary.
  const words=value.trim().replace(/^(?:the|a|an|some)\s+/iu,"").split(/\s+/u);
  return words.length===1||words.every(word=>/^(?:[A-Z][A-Za-z0-9_/-]*|[0-9][A-Za-z0-9_/-]*)$/u.test(word));
}
