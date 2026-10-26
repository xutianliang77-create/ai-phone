import {mutateSessionRecord} from './sessions-runtime.repository.js';
import * as legacy from './sessions.repository.js';
export function saveSharedControlCompletion(sessionId:string,consumedSeconds:number,receipt:string){
 return mutateSessionRecord(sessionId,'control-completed',{consumedSeconds,receipt},current=>{
  if(current.billingAuthority!=='cloudflare_v10')throw Error('Control authority mismatch');
  const next={...structuredClone(current),consumedSeconds,status:'ended' as const,endedAt:current.endedAt??new Date().toISOString(),gatewayFinalizationReceipt:receipt,finalizationIdempotencyKey:'finalize:'+sessionId,finalizedAt:current.finalizedAt??new Date().toISOString()};
  return {next,result:next};
 },()=>legacy.saveSharedControlCompletion(sessionId,consumedSeconds,receipt));
}
