import {randomUUID} from 'node:crypto';
import {sql,command,assertion} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash} from './common.mjs';

// The new 1.0 service does not generate legacy wallet/session data. If such
// data exists for this account, do not alter it as an incidental cleanup.
const legacyTables=[
 ['public_sessions','owner_id'],['credit_reservations','user_id'],['credit_lots','user_id'],['credit_ledger','user_id'],
 ['purchase_orders','owner_id'],['apple_transactions','owner_id'],['apple_notification_inbox','owner_id'],
 ['apple_refund_state','owner_id'],['apple_transaction_evidence','owner_id'],['apple_billing_actions','owner_id'],
 ['apple_consumption_consents','owner_id'],['apple_consumption_reports','owner_id'],['billing_cases','owner_id'],
 ['billing_usage_compensations','owner_id'],['trusted_finalizations','owner_id'],['model_grants','owner_id'],
 ['device_permits','owner_id'],['device_permit_owner_claims','owner_id'],['device_permit_issues','owner_id'],
 ['device_permit_cancellations','owner_id'],['device_usage_receipts','owner_id'],['management_audit','actor_id'],
 ['billing_case_actions','actor_id'],
];
const retainedCommands=['v10.subscription.sync','v10.subscription.status','v10.subscription.notification','v10.subscription.notification.processed','v10.subscription.restore'];

export async function finalizeDeletion(ctx,owner,now=Date.now()){
 const row=await ctx.store.read(sql(`SELECT j.state,j.job_id,j.event_prefix,a.app_account_token,a.deletion_requested_ms
  FROM v10_account_deletion_recovery j JOIN accounts a ON a.user_id=j.owner_id
  WHERE j.owner_id=? AND a.status='deletion_requested' AND j.state IN('needs_finalization','manual_apple_required','reconcile_required')`,owner));
 if(!row)return {status:'not_ready'};
 const active=await ctx.store.read(sql("SELECT MAX(expires_ms) AS until_ms FROM v10_device_licenses WHERE owner_id=? AND state='active' AND expires_ms>?",owner,now));
 if(active?.until_ms){
  const wait=command('v10-delete-wait:'+hash([row.job_id,active.until_ms]),'system:v10-deletion','v10.account.wait',{jobId:row.job_id,untilMs:active.until_ms},now);
  await ctx.store.execute(wait,{statements:[sql('UPDATE v10_account_deletion_recovery SET due_ms=?,updated_ms=? WHERE owner_id=? AND state=?',active.until_ms,now,owner,row.state)],
   receipt:sql("SELECT json_object('status','waiting') AS receipt")});
  return {status:'waiting_for_offline_expiry',untilMs:active.until_ms};
 }
 const guard=legacyTables.map(([table,column])=>`NOT EXISTS(SELECT 1 FROM ${table} WHERE ${column}=?)`).join(' AND ');
 const legacy=await ctx.store.read(sql(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM finance_outbox
  WHERE owner_id=? AND NOT (event_type IN ('apple.revoke','account.content_erase_requested') AND substr(event_id,1,length(?))=?))
  AND NOT EXISTS(SELECT 1 FROM usage_accounts WHERE user_id=? AND (available_seconds<>0 OR reserved_seconds<>0)) THEN 0 ELSE 1 END AS found`,
  ...legacyTables.map(()=>owner),owner,row.event_prefix,row.event_prefix,owner));
 if(legacy?.found!==0){
  const hold=command('v10-delete-hold:'+hash(row.job_id),'system:v10-deletion','v10.account.hold',{jobId:row.job_id},now);
  await ctx.store.execute(hold,{statements:[sql("INSERT OR IGNORE INTO v10_account_deletion_holds VALUES(?,'legacy_data_requires_review',?)",owner,now)],
   receipt:sql("SELECT json_object('status','held') AS receipt")});
  return {status:'legacy_data_requires_review'};
 }
 const manual=row.state!=='needs_finalization',tomb='v10-tomb-'+randomUUID(),replacement=randomUUID();
 const c=command('v10-delete-final:'+hash(row.job_id),'system:v10-deletion','v10.account.finalize',
  {jobId:row.job_id,manual},now);
 const noLegacy=assertion(c,'no_legacy_data',`${guard} AND NOT EXISTS(SELECT 1 FROM finance_outbox
  WHERE owner_id=? AND NOT (event_type IN ('apple.revoke','account.content_erase_requested') AND substr(event_id,1,length(?))=?))
  AND NOT EXISTS(SELECT 1 FROM usage_accounts WHERE user_id=? AND (available_seconds<>0 OR reserved_seconds<>0))`,
  ...legacyTables.map(()=>owner),owner,row.event_prefix,row.event_prefix,owner);
 await ctx.store.execute(c,{statements:[
  assertion(c,'deletion_state',`EXISTS(SELECT 1 FROM accounts a JOIN v10_account_deletion_recovery j ON j.owner_id=a.user_id
   WHERE a.user_id=? AND a.status='deletion_requested' AND j.state=? AND j.job_id=? AND a.app_account_token=?)`,owner,row.state,row.job_id,row.app_account_token),
  assertion(c,'offline_expiry',"NOT EXISTS(SELECT 1 FROM v10_device_licenses WHERE owner_id=? AND state='active' AND expires_ms>?)",owner,now),
  noLegacy,
  ...(manual?[]:[assertion(c,'apple_revoke_confirmed',`NOT EXISTS(SELECT 1 FROM apple_credentials WHERE user_id=?)
   AND NOT EXISTS(SELECT 1 FROM finance_outbox WHERE owner_id=? AND event_type='apple.revoke' AND state<>'done' AND substr(event_id,1,length(?))=?)`,owner,owner,row.event_prefix,row.event_prefix)]),
  sql('UPDATE accounts SET app_account_token=?,updated_ms=? WHERE user_id=? AND status=\'deletion_requested\'',replacement,now,owner),
  sql("INSERT INTO accounts(user_id,app_account_token,status,authorization_epoch,created_ms,updated_ms) VALUES(?,?,'deleted',1,?,?)",tomb,row.app_account_token,now,now),
  sql('UPDATE v10_deletion_status_capabilities SET owner_id=?,completed_ms=?,apple_revocation=? WHERE owner_id=?',tomb,now,manual?'manual_required':'confirmed',owner),
  sql('UPDATE v10_subscription_chains SET owner_id=? WHERE owner_id=?',tomb,owner),
  sql('UPDATE v10_subscription_transactions SET owner_id=? WHERE owner_id=?',tomb,owner),
  sql('UPDATE v10_subscription_status SET owner_id=? WHERE owner_id=?',tomb,owner),
  sql('UPDATE v10_subscription_events SET owner_id=? WHERE owner_id=?',tomb,owner),
  sql('UPDATE v10_subscription_restore_bindings SET owner_id=? WHERE owner_id=?',tomb,owner),
  sql('UPDATE v10_subscription_restore_events SET owner_id=? WHERE owner_id=?',tomb,owner),
  sql('UPDATE v10_subscription_restore_events SET previous_owner_id=? WHERE previous_owner_id=?',tomb,owner),
  sql(`UPDATE command_results SET owner_id=? WHERE owner_id=? AND operation IN (${retainedCommands.map(()=>'?').join(',')})`,tomb,owner,...retainedCommands),
  sql('DELETE FROM command_results WHERE owner_id=?',owner),
  sql("INSERT OR REPLACE INTO v10_account_deletion_receipts SELECT token_hash,?,?,?,MIN(expires_ms,?) FROM account_tokens WHERE user_id=? AND expires_ms>?",
   tomb,manual?'manual_required':'confirmed',now,now+7*86400000,owner,now),
  sql('DELETE FROM v10_device_statistics WHERE owner_id=?',owner),
  sql('DELETE FROM v10_device_licenses WHERE owner_id=?',owner),
  sql('DELETE FROM v10_device_license_requests WHERE owner_id=?',owner),
  sql('DELETE FROM v10_device_license_cancellations WHERE owner_id=?',owner),
  sql('DELETE FROM device_permit_challenges WHERE owner_id=?',owner),
  sql('DELETE FROM device_permit_keys WHERE owner_id=?',owner),
  sql('DELETE FROM account_consents WHERE owner_id=?',owner),
  sql('DELETE FROM account_agreements WHERE user_id=?',owner),
  sql('DELETE FROM apple_auth_challenges WHERE owner_id=? OR target_user_id=?',owner,owner),
  sql('DELETE FROM apple_refresh_claims WHERE identity_key IN (SELECT identity_key FROM identities WHERE user_id=?)',owner),
  sql('DELETE FROM apple_credentials WHERE user_id=?',owner),
  sql('DELETE FROM account_tokens WHERE user_id=?',owner),
  sql('DELETE FROM identities WHERE user_id=?',owner),
  sql('DELETE FROM usage_accounts WHERE user_id=?',owner),
  sql("DELETE FROM finance_outbox WHERE owner_id=? AND event_type IN ('apple.revoke','account.content_erase_requested') AND substr(event_id,1,length(?))=?",owner,row.event_prefix,row.event_prefix),
  sql('DELETE FROM v10_account_deletion_recovery WHERE owner_id=?',owner),
  sql('DELETE FROM accounts WHERE user_id=? AND status=\'deletion_requested\'',owner),
  assertion(c,'old_removed',"NOT EXISTS(SELECT 1 FROM accounts WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM identities WHERE user_id=?)",owner,owner),
 ],receipt:sql("SELECT json_object('status','completed','appleRevocation',?) AS receipt",manual?'manual_required':'confirmed')});
 return {status:'completed',appleRevocation:manual?'manual_required':'confirmed'};
}
