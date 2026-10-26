import {D1FinalizationsRepository,sql} from '../vendor/reused-control-core.mjs';
import {verifyGatewayStopReceipt} from '../../../packages/platform-security/src/gateway-stop-receipt.ts';
import {hash,fail,requireSessionId,guardedStore} from './protocol.mjs';
import {assertion} from '../vendor/reused-control-core.mjs';

export async function finishControl(service,receipt,now) {
  const encoded=typeof receipt==='string'?receipt.split('.')[1]:null;
  let candidate;try {candidate=JSON.parse(Buffer.from(encoded??'','base64url').toString());}catch{fail('v10_stop_proof');}
  requireSessionId(candidate.sessionId);
  const row=await service.session(candidate.sessionId);
  const proof=verifyGatewayStopReceipt(receipt,service.config.signingSecret,{sessionId:row.session_id,userId:row.owner_id},now);
  if (!proof) fail('v10_stop_proof');
  const hold=await service.store.read(sql('SELECT seconds FROM credit_reservations WHERE session_id=? AND user_id=?',row.session_id,row.owner_id));
  if(!hold || proof.billableSeconds>hold.seconds)fail('v10_meter_exceeds_reservation');
  const final=new D1FinalizationsRepository(service.store,service.config.deploymentId), binding={sessionId:row.session_id,ownerId:row.owner_id,bindingHash:row.binding_hash};
  await final.recordConfirmed({...binding,activeMs:proof.billableSeconds*1000,meterBasis:'server_observed_active_ms',meterStatus:'confirmed',stopConfirmed:true,
    providerReconciliation:'reconcile_required',contentReceiptRef:'v10-no-content:'+row.session_id,
    stopWatermarkHash:hash(receipt),proofRef:'v10-processing-gateway:'+hash(receipt)},now);
  const settled=await final.settle(binding,now);
  // No wallet or other account's content is returned on this receipt-only path.
  return {contractVersion:1,status:'ended',sessionId:row.session_id,consumedSeconds:settled.receipt.consumedSeconds,replayed:settled.replayed,receiptHash:hash(receipt)};
}
export async function cancelUnadmitted(service,actor,id,now) {
  await service.requireActor(actor,now);const row=await service.session(id);
  if(row.owner_id!==actor.id)fail('v10_account_binding');
  const prior=await service.store.read(sql('SELECT proof_ref FROM trusted_finalizations WHERE session_id=? AND owner_id=?',id,actor.id));
  if(row.state!=='prepared' && prior?.proof_ref!=='v10-never-admitted:'+id)fail('v10_stop_proof_required');
  const activated=await service.store.read(sql('SELECT command_id FROM command_results WHERE command_id=?','v10-activate:'+id));
  if(activated)fail('v10_stop_proof_required');
  const guarded=guardedStore(service.store,c=>[
    assertion(c,'never_admitted',"EXISTS(SELECT 1 FROM public_sessions WHERE session_id=? AND state='prepared') AND NOT EXISTS(SELECT 1 FROM command_results WHERE command_id=?)",id,'v10-activate:'+id),
    sql("UPDATE public_sessions SET state='ended',version=version+1,updated_ms=? WHERE session_id=? AND state='prepared'",now,id)]);
  const final=new D1FinalizationsRepository(prior?service.store:guarded,service.config.deploymentId),binding={sessionId:id,ownerId:actor.id,bindingHash:row.binding_hash};
  await final.recordConfirmed({...binding,activeMs:0,meterBasis:'server_observed_active_ms',meterStatus:'confirmed',stopConfirmed:true,
    providerReconciliation:'confirmed',contentReceiptRef:'v10-never-admitted:'+id,stopWatermarkHash:hash(id+':never-admitted'),proofRef:'v10-never-admitted:'+id},now);
  const result=await new D1FinalizationsRepository(service.store,service.config.deploymentId).releaseConfirmed(binding,now);
  return {status:'ended',sessionId:id,consumedSeconds:0,replayed:result.replayed};
}
