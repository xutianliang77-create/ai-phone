import {createHash} from 'node:crypto';
import type {CreateRealtimeSessionRequest} from '@translation/contracts';
import {createRealtimeSession} from './realtime.service.js';
import {findSession} from '../sessions/sessions-runtime.repository.js';
import {withSessionWriteLock} from '../sessions/session-write-coordinator.js';
export class CreationConflict extends Error{constructor(readonly code:string){super(code);}}
export async function createIdempotentSession(owner:string,input:CreateRealtimeSessionRequest,authHash:string,key:unknown){
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw new CreationConflict('creation_request_key_required');
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const sid='v10-'+hash([owner,key]),requestHash=hash([owner,input,authHash]);
 return withSessionWriteLock(sid,async()=>{
  const existing=await findSession(sid);
  if(existing){
   if(existing.userId!==owner||existing.creationRequestHash!==requestHash)throw new CreationConflict('creation_request_conflict');
   if(existing.status==='ended'||existing.status==='failed')throw new CreationConflict('creation_session_terminal');
   if(!existing.creationResponse)throw new CreationConflict('creation_response_pending');
   return existing.creationResponse;
  }
  return createRealtimeSession(owner,input,{ownerAuthSessionHash:authHash,sessionId:sid,creationRequestHash:requestHash});
 });
}
