import {sql,command,activeAccount,assertion} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash,fail,canonical,digest} from './common.mjs';
import {currentEntitlement} from './subscription-policy.mjs';
export class SubscriptionRepository{
 constructor(store,config){this.store=store;this.config=config;}
 chainKey(t){return hash([t.environment,t.bundleId,t.originalTransactionId]);}
 transactionKey(t){return hash([t.environment,t.bundleId,t.transactionId]);}
 async sync(actor,t,proof,now,event='client_sync',notificationId){
  const chain=this.chainKey(t),tx=this.transactionKey(t);
  const owner=await this.store.read(sql('SELECT * FROM v10_subscription_chains WHERE chain_key=?',chain));
  if(owner&&owner.owner_id!==actor.id)fail('v10_subscription_owned_by_other_account',403);
  const a=await this.store.read(sql("SELECT app_account_token,authorization_epoch,status FROM accounts WHERE user_id=?",actor.id));
  if(!a||!(actor.kind==='system'?['active','deletion_requested','deleted']:['active']).includes(a.status))fail('v10_account_unavailable',403);
  if(t.appAccountToken&&t.appAccountToken!==a.app_account_token.toLowerCase()){
   const binding=await this.store.read(sql('SELECT owner_id,original_app_account_token FROM v10_subscription_restore_bindings WHERE chain_key=?',chain));
   if(!binding||binding.owner_id!==actor.id||binding.original_app_account_token!==t.appAccountToken)fail('v10_subscription_account_mismatch',403);
  }
  if(!t.appAccountToken&&!owner&&proof?.storeKitCurrentEntitlement!==true)fail('v10_unbound_purchase_recovery_required');
  const existing=await this.store.read(sql('SELECT signed_ms,payload_hash FROM v10_subscription_transactions WHERE transaction_key=?',tx));
  if(existing&&existing.signed_ms===t.signedAtMs&&existing.payload_hash!==t.payloadHash)fail('v10_subscription_evidence_conflict');
  const c=command('v10-subscription-v2:'+tx+':'+t.signedAtMs+':'+hash(actor.id).slice(0,16),actor.id,'v10.subscription.sync',{payloadHash:t.payloadHash},now);
  await this.store.execute(c,{statements:[actor.kind==='system'?assertion(c,'known_billing_owner',"EXISTS(SELECT 1 FROM accounts WHERE user_id=? AND status IN('active','deletion_requested','deleted'))",actor.id):activeAccount(c,actor.authorizationEpoch),
   ...(actor.kind==='system'?[]:[assertion(c,'current_token',"EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND user_id=? AND authorization_epoch=? AND revoked_ms IS NULL AND expires_ms>?)",actor.tokenHash,actor.id,actor.authorizationEpoch,now)]),
   assertion(c,'chain_owner',"NOT EXISTS(SELECT 1 FROM v10_subscription_chains WHERE chain_key=? AND owner_id<>?)",chain,actor.id),
   sql(`INSERT INTO v10_subscription_chains VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chain_key) DO UPDATE SET updated_ms=excluded.updated_ms`,chain,actor.id,t.productId,t.bundleId,t.environment,t.originalTransactionId,now,now),
   sql(`INSERT INTO v10_subscription_transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(transaction_key) DO UPDATE SET starts_ms=excluded.starts_ms,expires_ms=excluded.expires_ms,signed_ms=excluded.signed_ms,
    revoked_ms=excluded.revoked_ms,payload_hash=excluded.payload_hash
    WHERE v10_subscription_transactions.owner_id=excluded.owner_id AND excluded.signed_ms>v10_subscription_transactions.signed_ms`,
    tx,chain,actor.id,t.productId,t.environment,t.appAccountToken,t.kind,t.startsAtMs,t.expiresAtMs,t.signedAtMs,t.revokedAtMs,t.priceMilli,t.currency,t.payloadHash),
   sql('INSERT OR IGNORE INTO v10_subscription_events VALUES(?,?,?,?,?,?)',notificationId??c.id,actor.id,tx,event,t.payloadHash,now),
  ],receipt:sql("SELECT json_object('status','recorded','transactionKey',?) AS receipt",tx)});
  return this.entitlement(actor.id,now);
 }
 async restoreAfterDeletion(actor,presented,evidence,proofHash,now){
  digest(proofHash);
  const chain=this.chainKey(presented),t=evidence.transaction,tx=this.transactionKey(t),
   prior=await this.store.read(sql(`SELECT c.owner_id,a.status,a.app_account_token,b.original_app_account_token
    FROM v10_subscription_chains c JOIN accounts a ON a.user_id=c.owner_id
    LEFT JOIN v10_subscription_restore_bindings b ON b.chain_key=c.chain_key WHERE c.chain_key=?`,chain));
  if(!prior||prior.owner_id===actor.id||prior.status!=='deleted')fail('v10_restore_previous_account_not_deleted',403);
  const original=(prior.original_app_account_token??prior.app_account_token)?.toLowerCase()??null;
  if(this.chainKey(t)!==chain||presented.revokedAtMs!==null||t.revokedAtMs!==null||
   (presented.appAccountToken&&presented.appAccountToken!==original&&presented.appAccountToken!==prior.app_account_token.toLowerCase())||
   (t.appAccountToken&&t.appAccountToken!==original&&t.appAccountToken!==prior.app_account_token.toLowerCase())||
   evidence.verifiedAtMs>now||evidence.verifiedAtMs<=now-60000||![1,4].includes(evidence.status))fail('v10_restore_evidence_invalid',403);
  const expires=evidence.status===4?Math.max(t.expiresAtMs,evidence.renewal.gracePeriodExpiresDate??0):t.expiresAtMs;
  if(t.startsAtMs>now||expires<=now)fail('v10_restore_entitlement_not_active',403);
  const c=command('v10-restore:'+hash([chain,actor.id,proofHash]),actor.id,'v10.subscription.restore',
   {chain,proofHash,applePayloadHash:t.payloadHash,verifiedAtMs:evidence.verifiedAtMs},now);
  await this.store.execute(c,{statements:[activeAccount(c,actor.authorizationEpoch),
   assertion(c,'token',"EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND user_id=? AND authorization_epoch=? AND revoked_ms IS NULL AND expires_ms>?)",actor.tokenHash,actor.id,actor.authorizationEpoch,now),
   assertion(c,'deleted_owner',"EXISTS(SELECT 1 FROM v10_subscription_chains c JOIN accounts a ON a.user_id=c.owner_id WHERE c.chain_key=? AND c.owner_id=? AND a.status='deleted')",chain,prior.owner_id),
   assertion(c,'old_offline_expired',"NOT EXISTS(SELECT 1 FROM v10_device_licenses WHERE owner_id=? AND state='active' AND expires_ms>?)",prior.owner_id,now),
   assertion(c,'no_newer_revocation',"NOT EXISTS(SELECT 1 FROM v10_subscription_transactions WHERE transaction_key=? AND revoked_ms IS NOT NULL AND signed_ms>=?)",tx,t.signedAtMs),
   assertion(c,'no_newer_transaction',"NOT EXISTS(SELECT 1 FROM v10_subscription_transactions WHERE transaction_key=? AND signed_ms>?)",tx,t.signedAtMs),
   assertion(c,'no_newer_status',"NOT EXISTS(SELECT 1 FROM v10_subscription_status WHERE chain_key=? AND signed_ms>?)",chain,evidence.renewal.signedDate),
   sql('UPDATE v10_subscription_chains SET owner_id=?,updated_ms=? WHERE chain_key=? AND owner_id=?',actor.id,now,chain,prior.owner_id),
   sql('UPDATE v10_subscription_transactions SET owner_id=? WHERE chain_key=? AND owner_id=?',actor.id,chain,prior.owner_id),
   sql(`INSERT INTO v10_subscription_transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transaction_key) DO UPDATE SET
    starts_ms=excluded.starts_ms,expires_ms=excluded.expires_ms,signed_ms=excluded.signed_ms,revoked_ms=excluded.revoked_ms,payload_hash=excluded.payload_hash
    WHERE v10_subscription_transactions.owner_id=excluded.owner_id AND excluded.signed_ms>v10_subscription_transactions.signed_ms`,
    tx,chain,actor.id,t.productId,t.environment,t.appAccountToken,t.kind,t.startsAtMs,t.expiresAtMs,t.signedAtMs,t.revokedAtMs,t.priceMilli,t.currency,t.payloadHash),
   sql(`INSERT INTO v10_subscription_status VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(chain_key) DO UPDATE SET
    owner_id=excluded.owner_id,verified_ms=excluded.verified_ms,signed_ms=excluded.signed_ms,status=excluded.status,
    auto_renew=excluded.auto_renew,billing_retry=excluded.billing_retry,grace_expires_ms=excluded.grace_expires_ms,payload_hash=excluded.payload_hash
    WHERE excluded.signed_ms>=v10_subscription_status.signed_ms`,chain,actor.id,evidence.verifiedAtMs,evidence.renewal.signedDate,evidence.status,
    evidence.renewal.autoRenewStatus,evidence.renewal.isInBillingRetryPeriod===true?1:0,evidence.renewal.gracePeriodExpiresDate??null,hash([t.payloadHash,evidence.renewal])),
   sql(`INSERT INTO v10_subscription_restore_bindings VALUES(?,?,?,?,?) ON CONFLICT(chain_key) DO UPDATE SET
    owner_id=excluded.owner_id,original_app_account_token=excluded.original_app_account_token,restored_ms=excluded.restored_ms,proof_hash=excluded.proof_hash`,chain,actor.id,original,now,proofHash),
   sql('INSERT INTO v10_subscription_restore_events VALUES(?,?,?,?,?,?)',c.id,chain,prior.owner_id,actor.id,proofHash,now),
   sql('INSERT OR IGNORE INTO v10_subscription_events VALUES(?,?,?,?,?,?)',c.id,actor.id,tx,'restore_after_deletion',t.payloadHash,now),
  ],receipt:sql("SELECT json_object('status','restored','transactionKey',?) AS receipt",tx)});
  return this.entitlement(actor.id,now);
 }
 async entitlement(ownerId,now){
  const all=await this.store.readAll(sql(`SELECT t.*,s.status apple_status,s.verified_ms status_verified_ms,s.grace_expires_ms FROM v10_subscription_transactions t LEFT JOIN v10_subscription_status s ON s.chain_key=t.chain_key WHERE t.owner_id=?`,ownerId));
  const rows=all.filter(r=>(r.apple_status===null||[1,4].includes(r.apple_status))&&(!this.config.requireFreshStatus||(r.status_verified_ms>now-60000&&r.status_verified_ms<=now)));
  let e=currentEntitlement(rows,now);
  if(!e.valid&&all.length){const latest=[...all].sort((a,b)=>b.signed_ms-a.signed_ms)[0];
   e={...e,expiresAtMs:latest.expires_ms,status:latest.revoked_ms||latest.apple_status===5?'revoked':latest.apple_status===3?'billing_retry':latest.expires_ms<=now?'expired':'verification_required'};
  }
  return {...e,productId:this.config.productId,priceMinorCny:1000,currency:'CNY',period:'P1M',trialDays:7,billingBasis:'entitlement_period'};
 }
 async ledger(ownerId){return {ledger:await this.store.readAll(sql('SELECT event_key,event_type,transaction_key,recorded_ms FROM v10_subscription_events WHERE owner_id=? ORDER BY recorded_ms DESC LIMIT 500',ownerId))};}
}
