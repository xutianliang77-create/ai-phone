import type {ServerRealtimeEvent,SessionEndReason} from '@translation/contracts';
import type {RealtimeProvider} from '../providers/realtime-provider.js';

/** Uses the original provider subscription/finalizer. No independent session,
 * retry, supplier socket or billing path is created for asynchronous errors. */
export function bindRealtimeProviderEvents(provider:RealtimeProvider,sessionId:string,options:{
  isCurrent:()=>boolean;publicConnection:boolean;send:(event:ServerRealtimeEvent)=>void;
  beginFinalization:()=>void;end:(reason:SessionEndReason)=>Promise<void>;onError:(error:unknown)=>void;
}) {
  let terminating=false;
  return provider.setEventListener?.(sessionId,event=>{
    if(terminating||!options.isCurrent()||!('sessionId' in event)||event.sessionId!==sessionId)return;
    if(options.publicConnection&&event.type==='error'&&event.stage==='asr'){
      terminating=true;
      options.beginFinalization();options.send(event);
      void options.end('connection_error').catch(options.onError);
    }else options.send(event);
  })??(()=>{});
}
