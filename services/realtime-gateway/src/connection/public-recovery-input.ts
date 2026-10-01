import type {ClientRealtimeEvent,ServerRealtimeEvent} from '@translation/contracts';
import {buildError} from '../protocol/outgoing-event-builder.js';

/** One-use bridge, followed by ordinary same-socket pause/resume. */
export class PublicRecoveryInput {
  confirmed=false;
  private matched=false;
  private firstAudio=true;
  constructor(private readonly sessionId:string,private readonly bridge:{lastAcceptedSample:number;nextSequence:number}|undefined,
    private readonly send:(event:ServerRealtimeEvent)=>void){}
  accept(event:ClientRealtimeEvent){
    if(event.sessionId!==this.sessionId)return this.reject('session');
    if(event.type==='session.resume'){
      if(this.confirmed)return event.recovery===undefined||this.reject('session');
      if(this.matched)return this.reject('session');
      if(!this.bridge||event.recovery?.lastAcceptedSample!==this.bridge.lastAcceptedSample||
        event.recovery?.nextSequence!==this.bridge.nextSequence)return this.reject('session');
      this.matched=true;
    }
    if(event.type==='audio.frame'&&(!this.confirmed||this.firstAudio&&event.sequence!==this.bridge?.nextSequence))return this.reject('asr');
    if(!this.confirmed&&!['session.resume','session.end','text.language.result'].includes(event.type))return this.reject('session');
    return true;
  }
  confirm(){if(this.matched)this.confirmed=true;}
  acceptedAudio(){this.firstAudio=false;}
  private reject(stage:'session'|'asr'){
    this.send(buildError('bad_event','Public recovery input does not match the trusted watermark',
      {sessionId:this.sessionId,stage,retryable:false}));return false;
  }
}
