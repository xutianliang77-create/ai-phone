import {createHash,randomUUID} from 'node:crypto';
import {DEVICE_TEXT_LANGUAGE_METHOD,isDeviceTextLanguageResult,type DeviceTextLanguageRequest,type TranslationLanguageCode} from '@translation/contracts';

export type TextLanguageDecision={status:'detected';language:TranslationLanguageCode;confidence:number}|
  {status:'unknown';reason:'unavailable'|'timeout'|'ambiguous'|'unsupported'|'stale'};
type Pending={request:DeviceTextLanguageRequest;finish:(value:TextLanguageDecision)=>void};
/** Owned by ONE authenticated socket, not a global/account cache. Replies are
 * consumed outside the audio/control queue so a final flush cannot deadlock it. */
export class DeviceTextLanguageBroker {
  private pending=new Map<string,Pending>();
  private closed=false;
  constructor(private readonly sessionId:string,private readonly sources:readonly TranslationLanguageCode[],
    private readonly send:(request:DeviceTextLanguageRequest)=>boolean,private readonly timeoutMs=2000){}
  identify(segmentId:string,revision:number,text:string):Promise<TextLanguageDecision>{
    if(this.closed||!text.trim()||text.length>16000||!Number.isSafeInteger(revision)||revision<1||this.pending.size>=32)
      return Promise.resolve({status:'unknown',reason:'unavailable'});
    for(const entry of this.pending.values())if(entry.request.segmentId===segmentId)entry.finish({status:'unknown',reason:'stale'});
    const request:DeviceTextLanguageRequest={type:'text.language.request',method:DEVICE_TEXT_LANGUAGE_METHOD,
      sessionId:this.sessionId,segmentId,revision,requestId:randomUUID(),text,
      textSha256:createHash('sha256').update(text,'utf8').digest('hex')};
    return new Promise(resolve=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      const finish=(value:TextLanguageDecision)=>{
        if(this.pending.get(request.requestId)?.request!==request)return;
        if(timer)clearTimeout(timer);this.pending.delete(request.requestId);resolve(value);
      };
      this.pending.set(request.requestId,{request,finish});
      timer=setTimeout(()=>finish({status:'unknown',reason:'timeout'}),this.timeoutMs);
      try{if(!this.send(request))finish({status:'unknown',reason:'unavailable'});}catch{finish({status:'unknown',reason:'unavailable'});}
    });
  }
  accept(value:unknown):boolean{
    if(this.closed||!isDeviceTextLanguageResult(value)||value.sessionId!==this.sessionId)return false;
    const entry=this.pending.get(value.requestId);if(!entry)return false;
    const r=entry.request;
    if(value.segmentId!==r.segmentId||value.revision!==r.revision||value.textSha256!==r.textSha256)return false;
    const entries=Object.entries(value.hypotheses).sort((a,b)=>b[1]-a[1]);
    const top=entries[0],second=entries[1]?.[1]??0;
    // No language hints/constraints were sent to Apple. Never renormalize an
    // unsupported top result into the user's output pair (third languages stay distinct).
    const language=top?.[0]==='zh-Hans'?'zh':top?.[0];
    const letters=r.text.match(/\p{L}/gu)??[];
    const latin=letters.filter(c=>/\p{Script=Latin}/u.test(c)).length;
    const substantial=letters.length>=4&&(latin<letters.length/2||
      letters.length>=8&&(r.text.match(/\p{Script=Latin}+/gu)?.length??0)>=2);
    if(!top||value.dominant!==top[0]||top[1]<0.85||top[1]-second<0.2||!substantial){
      entry.finish({status:'unknown',reason:'ambiguous'});return true;
    }
    if(!this.sources.includes(language as TranslationLanguageCode))entry.finish({status:'unknown',reason:'unsupported'});
    else entry.finish({status:'detected',language:language as TranslationLanguageCode,confidence:top[1]});
    return true;
  }
  close(){this.closed=true;for(const entry of this.pending.values())entry.finish({status:'unknown',reason:'unavailable'});}
}
