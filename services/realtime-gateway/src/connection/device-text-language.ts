import {createHash,randomUUID} from 'node:crypto';
import {DEVICE_TEXT_LANGUAGE_METHOD,isDeviceTextLanguageResult,isDeviceSpeechAudioRange,type DeviceTextLanguageRequest,type TranslationLanguageCode,type DeviceSpeechAudioRange,type DeviceSpeechAudioEvidence} from '@translation/contracts';
import {aggregateTextLanguages,textForLanguageObservation} from './text-language-evidence.js';
import {logPublicAsrLanguage} from '../metrics/public-asr-boundary-trace.js';

export type TextLanguageDecision={status:'detected';language:TranslationLanguageCode;confidence:number}|
  {status:'non_speech';reason:'no_speech_support'|'render_echo'}|
  {status:'unknown';reason:'unavailable'|'timeout'|'ambiguous'|'unsupported'|'stale'|'mixed_unaligned'};
type Pending={request:DeviceTextLanguageRequest;finish:(value:TextLanguageDecision)=>void};
/** Owned by ONE session and its currently authenticated socket. Replies are
 * consumed outside the audio/control queue so a final flush cannot deadlock it. */
export class DeviceTextLanguageBroker {
  private pending=new Map<string,Pending>();
  private closed=false;
  private disconnected=false;
  private speechEvidence=new Map<string,DeviceSpeechAudioEvidence|undefined>();
  constructor(private readonly sessionId:string,private readonly sources:readonly TranslationLanguageCode[],
    private readonly send:(request:DeviceTextLanguageRequest)=>boolean,private readonly timeoutMs=2000,
    private readonly speechEvidenceSupported=true){}
  identify(segmentId:string,revision:number,text:string,audioRange?:DeviceSpeechAudioRange):Promise<TextLanguageDecision>{
    if(!this.speechEvidenceSupported)audioRange=undefined;
    if(this.closed||this.disconnected||!text.trim()||text.length>16000||!Number.isSafeInteger(revision)||revision<1||this.pending.size>=32||audioRange&&!isDeviceSpeechAudioRange(audioRange))
      return Promise.resolve({status:'unknown',reason:'unavailable'});
    for(const entry of this.pending.values())if(entry.request.segmentId===segmentId)entry.finish({status:'unknown',reason:'stale'});
    const sourceTextSha256=createHash('sha256').update(text,'utf8').digest('hex');
    text=textForLanguageObservation(text);
    const request:DeviceTextLanguageRequest={type:'text.language.request',method:DEVICE_TEXT_LANGUAGE_METHOD,
      sessionId:this.sessionId,segmentId,revision,requestId:randomUUID(),text,
      textSha256:createHash('sha256').update(text,'utf8').digest('hex'),...(audioRange?{audioRange:{...audioRange}}:{})};
    return new Promise(resolve=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      const finish=(value:TextLanguageDecision)=>{
        if(this.pending.get(request.requestId)?.request!==request)return;
        if(timer)clearTimeout(timer);this.pending.delete(request.requestId);
        logPublicAsrLanguage({sessionId:this.sessionId,segmentId,revision,sourceTextSha256,stage:'language_decision',
          observationTextSha256:request.textSha256,projection:sourceTextSha256===request.textSha256?'identity':'v1_protected_terms',
          ...value});
        resolve(value);
      };
      this.pending.set(request.requestId,{request,finish});
      timer=setTimeout(()=>finish({status:'unknown',reason:'timeout'}),this.timeoutMs);
      try{if(!this.send(request))finish({status:'unknown',reason:'unavailable'});}catch{finish({status:'unknown',reason:'unavailable'});}
    });
  }
  accept(value:unknown):boolean{
    if(this.closed||this.disconnected||!isDeviceTextLanguageResult(value)||value.sessionId!==this.sessionId)return false;
    const entry=this.pending.get(value.requestId);if(!entry)return false;
    const r=entry.request;
    if(value.segmentId!==r.segmentId||value.revision!==r.revision||value.textSha256!==r.textSha256)return false;
    if(value.audioEvidence&&(!r.audioRange||['startSample','endSample','sampleRate'].some(k=>
      value.audioEvidence!.range[k as keyof DeviceSpeechAudioRange]!==r.audioRange![k as keyof DeviceSpeechAudioRange])))return false;
    if(r.audioRange){
      const key=this.speechKey(r.segmentId,r.revision,r.audioRange);
      if(this.speechEvidence.size>=256&&!this.speechEvidence.has(key))this.speechEvidence.delete(this.speechEvidence.keys().next().value!);
      this.speechEvidence.set(key,value.audioEvidence);
      if(value.audioEvidence?.decision==='non_speech'){
        entry.finish({status:'non_speech',reason:value.audioEvidence.reason as 'no_speech_support'|'render_echo'});return true;
      }
    }
    const raw=Object.entries(value.hypotheses).sort((a,b)=>b[1]-a[1]);
    const entries=aggregateTextLanguages(value.hypotheses);
    const top=entries[0],second=entries[1]?.[1]??0;
    // No language hints/constraints were sent to Apple. Never renormalize an
    // unsupported top result into the user's output pair (third languages stay distinct).
    const language=top?.[0];
    const letters=r.text.match(/\p{L}/gu)??[];
    const latin=letters.filter(c=>/\p{Script=Latin}/u.test(c)).length;
    const substantial=letters.length>=2;
    const shortObservation=letters.length<4||latin>=letters.length/2&&
      (letters.length<8||(r.text.match(/\p{Script=Latin}+/gu)?.length??0)<2);
    // A short utterance is not inherently an unknown language. Require stronger
    // independent evidence for it instead of rejecting even a 99.9999% result.
    // Keep ambiguous one-character/identifier-only replies unknown; never
    // borrow a preceding sentence's language or renormalize to the output pair.
    const minimumProbability=shortObservation?0.98:0.85,minimumMargin=shortObservation?0.8:0.2;
    logPublicAsrLanguage({sessionId:this.sessionId,segmentId:r.segmentId,revision:r.revision,stage:'language_observation',
      observationTextSha256:r.textSha256,dominant:value.dominant,hypotheses:value.hypotheses,
      canonicalHypotheses:Object.fromEntries(entries),substantial,shortObservation});
    if(!top||value.dominant!==raw[0]?.[0]||top[1]<minimumProbability||top[1]-second<minimumMargin||!substantial){
      entry.finish({status:'unknown',reason:'ambiguous'});return true;
    }
    if(!this.sources.includes(language as TranslationLanguageCode))entry.finish({status:'unknown',reason:'unsupported'});
    else entry.finish({status:'detected',language:language as TranslationLanguageCode,confidence:Math.min(1,top[1])});
    return true;
  }
  /** Same challenge/nonce/cache, also usable by fixed-language and other ASR adapters.
   * Missing/old-device evidence never pretends to be negative speech evidence. */
  async confirmSpeech(segmentId:string,revision:number,text:string,range:DeviceSpeechAudioRange):Promise<boolean>{
    if(!this.speechEvidenceSupported)return true;
    const key=this.speechKey(segmentId,revision,range);
    if(!this.speechEvidence.has(key))await this.identify(segmentId,revision,text,range);
    return this.speechEvidence.get(key)?.decision!=='non_speech';
  }
  /** Uncommitted previews may wait; unlike a final, missing evidence must not
   * briefly expose playback echo as a new utterance. A separate observation ID
   * prevents preview updates from cancelling the final's language challenge. */
  async confirmPreviewSpeech(segmentId:string,text:string,range:DeviceSpeechAudioRange):Promise<boolean>{
    if(!this.speechEvidenceSupported)return true;
    const id=`${segmentId}.preview`;
    if(id.length>240)return false;
    this.speechEvidence.delete(this.speechKey(id,1,range));
    await this.identify(id,1,text,range);
    return !this.closed&&this.speechEvidence.get(this.speechKey(id,1,range))?.decision==='speech';
  }
  private speechKey(id:string,revision:number,r:DeviceSpeechAudioRange){return `${id}:${revision}:${r.sampleRate}:${r.startSample}:${r.endSample}`;}
  // A confirmed pause already drained final speech. Cancel any late preview
  // challenge on transport loss; retaining its promise would deadlock cleanup.
  disconnectTransport(){this.disconnected=true;for(const entry of this.pending.values())entry.finish({status:'unknown',reason:'unavailable'});}
  resumeTransport(){if(!this.closed)this.disconnected=false;}
  close(){this.closed=true;this.disconnectTransport();this.speechEvidence.clear();}
}

export function transcriptAudioRange(startMs:number|undefined,endMs:number|undefined,sampleRate:number):DeviceSpeechAudioRange|undefined {
  if(startMs===undefined||endMs===undefined||!Number.isFinite(startMs)||!Number.isFinite(endMs))return;
  const r={startSample:Math.floor(startMs*sampleRate/1000),endSample:Math.ceil(endMs*sampleRate/1000),sampleRate};
  return isDeviceSpeechAudioRange(r)?r:undefined;
}
