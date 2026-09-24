import type {PublicModelAttemptEvent} from "@translation/contracts";
import type {SessionRecord} from "./session-record.js";

type Summary=NonNullable<SessionRecord["publicAttemptSummary"]>;
type Attempt={event:PublicModelAttemptEvent};

function emptySummary():Summary{
  const component=()=>({total:0,confirmed:0,uncertain:0,providerIds:[] as string[],modelIds:[] as string[]});
  return {total:0,states:{dispatching:0,confirmed:0,rejected:0,not_sent:0,uncertain:0},
    components:{asr:component(),translation:component(),tts:component()},reportedUsage:{}};
}

/** The session retains fixed-size counters; full attempts live in indexed
 * PostgreSQL records. A growing ASR watermark does not grow the summary. */
export function updatedPublicAttemptSummary(before:Summary|undefined,old:Attempt|undefined,next:Attempt):Summary{
  const result:Summary=structuredClone(before??emptySummary()),component=result.components[next.event.component];
  if(!old){
    result.total++;component.total++;
    if(!component.providerIds.includes(next.event.providerId))component.providerIds.push(next.event.providerId);
    if(!component.modelIds.includes(next.event.modelId))component.modelIds.push(next.event.modelId);
  }else{
    result.states[old.event.state]--;
    if(old.event.state==="confirmed")component.confirmed--;
    if(old.event.state==="uncertain")component.uncertain--;
  }
  result.states[next.event.state]++;
  if(next.event.state==="confirmed")component.confirmed++;
  if(next.event.state==="uncertain")component.uncertain++;
  for(const [field,value]of Object.entries(next.event.metadata?.usage??{})){
    if(typeof value==="number"&&Number.isFinite(value)&&value>=0){
      result.reportedUsage[field]=(result.reportedUsage[field]??0)+value;
    }
  }
  return result;
}
