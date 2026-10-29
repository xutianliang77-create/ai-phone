import {randomUUID} from 'node:crypto';
import {sql,command,activeAccount,assertion} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash} from './common.mjs';
import {finalizeDeletion} from './deletion-finalization.mjs';

// Register before the deletion transaction. If that transaction fails, the
// worker will not process the job while the account is still active.
export async function registerDeletionRecovery(ctx,actor,now,capabilityHash){
 if(capabilityHash!==undefined&&!/^[a-f0-9]{64}$/.test(capabilityHash))throw Object.assign(Error('v10_deletion_capability_invalid'),{code:'v10_deletion_capability_invalid',status:400});
 const c=command('v10-delete-job:'+hash([actor.id,actor.authorizationEpoch,capabilityHash??null]),actor.id,'v10.delete.register',
  {epoch:actor.authorizationEpoch,capabilityHash:capabilityHash??null},now);
 await ctx.store.execute(c,{statements:[activeAccount(c,actor.authorizationEpoch),
  assertion(c,'token',"EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND user_id=? AND revoked_ms IS NULL AND expires_ms>?)",actor.tokenHash,actor.id,now),
  sql("INSERT OR IGNORE INTO v10_account_deletion_recovery(owner_id,job_id,event_prefix,state,attempts,due_ms,created_ms,updated_ms) VALUES(?,?,?,'pending',0,?,?,?)",
   actor.id,randomUUID(),`delete:${actor.id}:${actor.authorizationEpoch}:`,now,now,now),
  ...(capabilityHash?[assertion(c,'capability_owner',"NOT EXISTS(SELECT 1 FROM v10_deletion_status_capabilities WHERE capability_hash=? AND owner_id<>?)",capabilityHash,actor.id),
   sql('INSERT OR IGNORE INTO v10_deletion_status_capabilities VALUES(?,?,?, ?,NULL,NULL)',capabilityHash,actor.id,now,now+7*86400000)]:[])],
  receipt:sql("SELECT json_object('status','registered') AS receipt")});
}

const MAX_ATTEMPTS=8, LEASE_MS=90000;
const delay=attempt=>Math.min(3600000,30000*2**Math.min(7,attempt-1));

export async function recoverDeletionOwner(ctx,owner,now=Date.now()){
 const row=await ctx.store.read(sql(`SELECT j.* FROM v10_account_deletion_recovery j JOIN accounts a ON a.user_id=j.owner_id
  WHERE j.owner_id=? AND j.state='pending' AND a.status='deletion_requested' AND j.due_ms<=?
  AND (j.lease_until_ms IS NULL OR j.lease_until_ms<=?)`,owner,now,now));
 if(!row)return {status:'not_due'};
 if(row.attempts>=MAX_ATTEMPTS){
  const exhausted=command('v10-delete-exhausted:'+hash([owner,row.attempts]),owner,'v10.delete.exhausted',{attempts:row.attempts},now);
  await ctx.store.execute(exhausted,{statements:[assertion(exhausted,'exhausted',`EXISTS(SELECT 1 FROM v10_account_deletion_recovery
   WHERE owner_id=? AND state='pending' AND attempts>=? AND (lease_until_ms IS NULL OR lease_until_ms<=?))`,owner,MAX_ATTEMPTS,now),
   sql("UPDATE v10_account_deletion_recovery SET state='reconcile_required',lease_id=NULL,lease_until_ms=NULL,updated_ms=? WHERE owner_id=?",now,owner)],
   receipt:sql("SELECT json_object('status','reconcile_required') AS receipt")});
  return {status:'reconcile_required'};
 }
 const lease=randomUUID(),attempt=row.attempts+1;
 const c=command('v10-delete-claim:'+lease,owner,'v10.delete.claim',{attempt},now);
 try{
  await ctx.store.execute(c,{statements:[assertion(c,'due',`EXISTS(SELECT 1 FROM v10_account_deletion_recovery j
    JOIN accounts a ON a.user_id=j.owner_id WHERE j.owner_id=? AND j.state='pending' AND j.attempts=?
    AND j.due_ms<=? AND (j.lease_until_ms IS NULL OR j.lease_until_ms<=?) AND a.status='deletion_requested')`,owner,row.attempts,now,now),
   sql('UPDATE v10_account_deletion_recovery SET attempts=?,lease_id=?,lease_until_ms=?,updated_ms=? WHERE owner_id=?',attempt,lease,now+LEASE_MS,now,owner)],
   receipt:sql("SELECT json_object('status','claimed') AS receipt")});
 }catch(error){
  const current=await ctx.store.read(sql('SELECT state,attempts,lease_until_ms FROM v10_account_deletion_recovery WHERE owner_id=?',owner));
  if(!current||current.state!=='pending'||current.attempts!==row.attempts||current.lease_until_ms>now)return {status:'claim_not_acquired'};
  throw error;
 }
 let failed=false;
 const rows=await ctx.store.readAll(sql("SELECT event_id FROM finance_outbox WHERE owner_id=? AND event_type='apple.revoke' AND state='pending' AND substr(event_id,1,length(?))=? ORDER BY event_id LIMIT 2",owner,row.event_prefix,row.event_prefix));
 for(const event of rows){try{await ctx.account.processRevocation(event.event_id,Math.max(now,Date.now()));}catch{failed=true;}}
 const counts=await ctx.store.read(sql(`SELECT
  (SELECT COUNT(*) FROM finance_outbox WHERE owner_id=? AND event_type='apple.revoke' AND state='pending' AND substr(event_id,1,length(?))=?) AS pending,
  (SELECT COUNT(*) FROM finance_outbox WHERE owner_id=? AND event_type='apple.revoke' AND state='done' AND substr(event_id,1,length(?))=?) AS done,
  (SELECT COUNT(*) FROM apple_credentials WHERE user_id=?) AS credentials`,owner,row.event_prefix,row.event_prefix,owner,row.event_prefix,row.event_prefix,owner));
 failed ||= Number(counts?.pending)>0 || Number(counts?.credentials)>0;
 const next=failed ? (attempt>=MAX_ATTEMPTS?'reconcile_required':'pending')
   : Number(counts?.done)>0?'needs_finalization':'manual_apple_required';
 const completed=Math.max(now,Date.now());
 const finish=command('v10-delete-result:'+lease,owner,'v10.delete.result',{attempt,state:next},completed);
 await ctx.store.execute(finish,{statements:[assertion(finish,'lease',
   "EXISTS(SELECT 1 FROM v10_account_deletion_recovery WHERE owner_id=? AND state='pending' AND lease_id=? AND attempts=?)",owner,lease,attempt),
  sql('UPDATE v10_account_deletion_recovery SET state=?,due_ms=?,lease_id=NULL,lease_until_ms=NULL,updated_ms=? WHERE owner_id=?',
   next,now+delay(attempt),completed,owner)],receipt:sql("SELECT json_object('status',?) AS receipt",next)});
 // needs_finalization is deliberately not called deleted: account data and
 // subscription ownership still need the separate deletion finalizer.
 return {status:next};
}

export async function recoverDueDeletions(ctx,now=Date.now()){
 const rows=await ctx.store.readAll(sql(`SELECT j.owner_id,j.state FROM v10_account_deletion_recovery j JOIN accounts a ON a.user_id=j.owner_id
  WHERE j.state IN('pending','needs_finalization','manual_apple_required','reconcile_required') AND a.status='deletion_requested' AND j.due_ms<=?
  AND NOT EXISTS(SELECT 1 FROM v10_account_deletion_holds h WHERE h.owner_id=j.owner_id)
  AND (j.lease_until_ms IS NULL OR j.lease_until_ms<=?) ORDER BY j.due_ms LIMIT 1`,now,now));
 const outcomes=[];
 for(const row of rows)outcomes.push(row.state==='pending'?await recoverDeletionOwner(ctx,row.owner_id,now):await finalizeDeletion(ctx,row.owner_id,now));
 return outcomes;
}

// These are only expired deletion-status capabilities, never financial or
// historical outbox rows. Keep the batch small and the tombstone ledger intact.
export async function purgeExpiredDeletionReceipts(ctx,now=Date.now()){
 const caps=await ctx.store.readAll(sql('SELECT capability_hash FROM v10_deletion_status_capabilities WHERE expires_ms<=? ORDER BY expires_ms LIMIT 10',now));
 const bearer=await ctx.store.readAll(sql('SELECT token_hash FROM v10_account_deletion_receipts WHERE expires_ms<=? ORDER BY expires_ms LIMIT 10',now));
 if(!caps.length&&!bearer.length)return {status:'none'};
 const c=command('v10-delete-receipts-expired:'+hash([caps.map(x=>x.capability_hash),bearer.map(x=>x.token_hash)]),
  'system:v10-deletion','v10.account.receipts.expire',{caps:caps.length,bearer:bearer.length},now);
 await ctx.store.execute(c,{statements:[
  ...caps.map(x=>sql('DELETE FROM v10_deletion_status_capabilities WHERE capability_hash=? AND expires_ms<=?',x.capability_hash,now)),
  ...bearer.map(x=>sql('DELETE FROM v10_account_deletion_receipts WHERE token_hash=? AND expires_ms<=?',x.token_hash,now)),
 ],receipt:sql("SELECT json_object('status','expired') AS receipt")});
 return {status:'expired',capabilities:caps.length,bearer:bearer.length};
}
