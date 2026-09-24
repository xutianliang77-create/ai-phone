import type {SessionReviewResponse} from "@translation/contracts";
import type {SessionRecord} from "./session-record.js";
import {sessionReviewSourceFingerprint} from "./session-review.js";

const fields=["provider","promptVersion","generatedAt","generationKind","sourceFingerprint","title","summary",
  "decisions","actionItems","keyFacts","risks","openQuestions","highlights","terms","evidenceSegmentIds"];
const highlightTypes=new Set(["time","money","todo","location","number","custom"]);
const factTypes=new Set(["time","money","location","number","custom"]);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:readonly string[])=>Object.keys(value).every(key=>allowed.includes(key));
const text=(value:unknown,max:number)=>typeof value==="string"&&value.length<=max;
const optionalText=(value:unknown,max:number)=>value===undefined||text(value,max);
function strings(value:unknown,maxItems:number,maxLength:number){
  return Array.isArray(value)&&value.length<=maxItems&&value.every(item=>text(item,maxLength));
}
function evidence(value:unknown,ids:Set<string>,maxItems:number):value is string[]{
  return Array.isArray(value)&&value.length<=maxItems&&new Set(value).size===value.length&&
    value.every(id=>typeof id==="string"&&ids.has(id));
}

/** Accept an account owner's already-computed phone rules for an ended public
 * record. It never calls a model or treats phone content as billing evidence. */
export function parseDeviceRulesReview(value:unknown,session:SessionRecord):SessionReviewResponse|undefined{
  if(session.status!=="ended"||!object(value)||!keys(value,fields)||JSON.stringify(value).length>32768||
    value.provider!=="local"||value.promptVersion!=="session_review_device_rules_v1"||
    value.generationKind!=="device_rules"||typeof value.sourceFingerprint!=="string"||
    !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)||!text(value.summary,4096)||!optionalText(value.title,240)){
    return undefined;
  }
  const ids=new Set(session.segments.filter(segment=>segment.sourceText?.trim()||segment.translatedText.trim()).map(segment=>segment.id));
  if(ids.size===0||!evidence(value.evidenceSegmentIds,ids,32)||value.evidenceSegmentIds.length===0||
    !strings(value.decisions,32,512)||!strings(value.risks,32,512)||!strings(value.openQuestions,32,512)||
    !Array.isArray(value.actionItems)||value.actionItems.length>64||
    !value.actionItems.every(item=>object(item)&&keys(item,["text","completed","owner","dueDate","evidenceSegmentIds"])&&
      typeof item.text==="string"&&text(item.text,512)&&item.text.trim()!==""&&
      (item.completed===undefined||typeof item.completed==="boolean")&&
      optionalText(item.owner,160)&&optionalText(item.dueDate,80)&&evidence(item.evidenceSegmentIds,ids,32)&&item.evidenceSegmentIds.length>0)||
    !Array.isArray(value.keyFacts)||value.keyFacts.length>64||
    !value.keyFacts.every(item=>object(item)&&keys(item,["type","text","evidenceSegmentIds"])&&
      factTypes.has(item.type as string)&&text(item.text,512)&&evidence(item.evidenceSegmentIds,ids,32)&&item.evidenceSegmentIds.length>0)||
    !Array.isArray(value.highlights)||value.highlights.length>32||
    !value.highlights.every(item=>object(item)&&keys(item,["type","text"])&&
      highlightTypes.has(item.type as string)&&text(item.text,300))||
    !Array.isArray(value.terms)||value.terms.length>64||
    !value.terms.every(item=>object(item)&&keys(item,["sourceText","translatedText"])&&
      text(item.sourceText,240)&&text(item.translatedText,240))){
    return undefined;
  }
  return {
    provider:"local",promptVersion:"session_review_device_rules_v1",
    generatedAt:new Date().toISOString(),generationKind:"device_rules",
    sourceFingerprint:sessionReviewSourceFingerprint(session),
    ...(value.title?{title:value.title as string}:{}),
    summary:value.summary as string,
    decisions:value.decisions as string[],risks:value.risks as string[],openQuestions:value.openQuestions as string[],
    actionItems:value.actionItems as SessionReviewResponse["actionItems"],
    keyFacts:value.keyFacts as SessionReviewResponse["keyFacts"],
    highlights:value.highlights as SessionReviewResponse["highlights"],
    terms:value.terms as SessionReviewResponse["terms"],
    evidenceSegmentIds:value.evidenceSegmentIds as string[],
  };
}
