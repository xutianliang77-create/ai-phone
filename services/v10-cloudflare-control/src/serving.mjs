import {activeAccount,assertion,command,sql} from '../vendor/reused-control-core.mjs';
import {fail,verifyInternal} from './protocol.mjs';

export async function servingControl(service,proof,now,fresh) {
  const body=verifyInternal(proof,service.config.signingSecret,now),row=await service.session(body.sessionId);
  if(body.deploymentId!==service.config.deploymentId||body.bindingHash!==row.binding_hash)fail('v10_internal_binding');
  const reservation=await service.store.read(sql("SELECT expires_ms FROM credit_reservations WHERE session_id=? AND state='active'",row.session_id));
  if(!reservation||reservation.expires_ms<=now)fail('v10_authorization_expired');
  const blocked=await service.store.read(sql(`SELECT 1 AS blocked FROM reservation_lot_allocations a JOIN credit_lots l ON l.lot_id=a.lot_id
    WHERE a.reservation_key=? AND l.refund_blocked=1 AND a.held_seconds>a.consumed_seconds+a.released_seconds LIMIT 1`,'hold:'+row.session_id));
  if(blocked)fail('v10_authorization_refund_blocked');
  await service.requireActor({id:row.owner_id,tokenHash:row.auth_token_hash,authorizationEpoch:row.authorization_epoch},now);
  const activation=await service.store.read(sql('SELECT receipt_json FROM command_results WHERE command_id=?','v10-activate:'+row.session_id));
  const epoch=Number(row.capture_epoch),prior=activation&&JSON.parse(activation.receipt_json);
  const latest=epoch<=1?prior:await service.store.read(sql('SELECT receipt_json FROM command_results WHERE command_id=?',`v10-resume:${row.session_id}:${epoch}`))
    .then(r=>r&&JSON.parse(r.receipt_json));
  if(row.state==='active'&&latest?.connectionNonce===body.connectionNonce)return latest;
  const first=row.state==='prepared'&&!activation;
  // A resume is possible only for the same retained gateway process after its
  // preceding provider closed. A stolen token has neither this private proof
  // nor the preceding nonce. No extra reservation or expiry extension occurs.
  const resume=row.state==='active'&&latest&&body.previousProviderClosed===true&&body.previousNonce===latest.connectionNonce;
  if(!fresh||(!first&&!resume))fail('v10_connection_conflict');
  const next=first?1:epoch+1;
  const c=command(first?'v10-activate:'+row.session_id:`v10-resume:${row.session_id}:${next}`,row.owner_id,
    'v10.control.activate',{connectionNonce:body.connectionNonce,bindingHash:row.binding_hash,epoch:next},now);
  const result=await service.store.execute(c,{statements:[activeAccount(c,row.authorization_epoch),
    assertion(c,'token',"EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND user_id=? AND revoked_ms IS NULL AND expires_ms>?)",row.auth_token_hash,row.owner_id,now),
    assertion(c,'admission_epoch','EXISTS(SELECT 1 FROM public_sessions WHERE session_id=? AND state=? AND capture_epoch=?)',row.session_id,row.state,epoch),
    sql("UPDATE public_sessions SET state='active',capture_epoch=?,version=version+1,updated_ms=? WHERE session_id=? AND capture_epoch=?",next,now,row.session_id,epoch)],
    receipt:sql("SELECT json_object('status','active','sessionId',?,'connectionNonce',?,'captureEpoch',?) AS receipt",row.session_id,body.connectionNonce,next)});
  return result.receipt;
}
