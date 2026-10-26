import {assertion,command,sql} from '../vendor/reused-control-core.mjs';
import {fail,hash} from './protocol.mjs';

export function requestSessionId(deployment,owner,key) {
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))fail('v10_request_key');
  return 'v10-'+hash([deployment,owner,key]);
}
export async function resolveRequest(service,actor,key,now,cancel=false) {
  await service.requireActor(actor,now);
  const sid=requestSessionId(service.config.deploymentId,actor.id,key);
  let row=await service.store.read(sql('SELECT state,owner_id FROM public_sessions WHERE session_id=?',sid));
  if(cancel&&!row) {
    const c=command('v10-cancel-request:'+sid,actor.id,'v10.control.cancel-request',{requestKey:key},now);
    try {
      await service.store.execute(c,{statements:[assertion(c,'not_created',
        'NOT EXISTS(SELECT 1 FROM public_sessions WHERE session_id=?)',sid)],
        receipt:sql("SELECT json_object('status','cancelled','sessionId',?) AS receipt",sid)});
    } catch(error) {
      row=await service.store.read(sql('SELECT state,owner_id FROM public_sessions WHERE session_id=?',sid));
      if(!row)throw error;
    }
    if(!row)return {status:'cancelled',sessionId:sid};
  }
  if(row?.owner_id!==actor.id&&row)fail('v10_account_binding');
  if(cancel&&row?.state==='prepared')return service.cancel(actor,sid,now);
  if(!row) {
    const tombstone=await service.store.read(sql('SELECT command_id FROM command_results WHERE command_id=?','v10-cancel-request:'+sid));
    return {status:tombstone?'cancelled':'absent',sessionId:sid};
  }
  if(row.state==='ended')return {status:'ended',sessionId:sid};
  const issued=await service.store.read(sql('SELECT receipt_json FROM command_results WHERE command_id=?','v10-issue:'+sid));
  const receipt=issued?JSON.parse(issued.receipt_json):null;
  return {status:row.state,sessionId:sid,...(!cancel&&receipt?{admissionExpiresAtMs:Date.parse(receipt.expiresAt),authorizationExpiresAtMs:receipt.expiresAtMs,authorization:receipt}:{})};
}
