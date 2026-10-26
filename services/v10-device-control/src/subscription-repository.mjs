import {sql,command,activeAccount,assertion} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash,fail,canonical} from './common.mjs';
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
  if(t.appAccountToken&&t.appAccountToken!==a.app_account_token.toLowerCase())fail('v10_subscription_account_mismatch',403);
  if(!t.appAccountToken&&!owner&&proof?.storeKitCurrentEntitlement!==true)fail('v10_unbound_purchase_recovery_required');
  const existing=await this.store.read(sql('SELECT signed_ms,payload_hash FROM v10_subscription_transactions WHERE transaction_key=?',tx));
  if(existing&&existing.signed_ms===t.signedAtMs&&existing.payload_hash!==t.payloadHash)fail('v10_subscription_evidence_conflict');
  const c=command('v10-subscription:'+tx+':'+t.signedAtMs,actor.id,'v10.subscription.sync',{payloadHash:t.payloadHash},now);
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
 async entitlement(ownerId,now){
  const all=await this.store.readAll(sql(`SELECT t.*,s.status apple_status,s.verified_ms status_verified_ms FROM v10_subscription_transactions t LEFT JOIN v10_subscription_status s ON s.chain_key=t.chain_key WHERE t.owner_id=?`,ownerId));
  const rows=all.filter(r=>(r.apple_status===null||[1,4].includes(r.apple_status))&&(!this.config.requireFreshStatus||(r.status_verified_ms>now-60000&&r.status_verified_ms<=now)));
  let e=currentEntitlement(rows,now);
  if(!e.valid&&all.length){const latest=[...all].sort((a,b)=>b.signed_ms-a.signed_ms)[0];
   e={...e,expiresAtMs:latest.expires_ms,status:latest.revoked_ms||latest.apple_status===5?'revoked':latest.apple_status===3?'billing_retry':latest.expires_ms<=now?'expired':'verification_required'};
  }
  return {...e,productId:this.config.productId,priceMinorCny:1000,currency:'CNY',period:'P1M',trialDays:7,billingBasis:'entitlement_period'};
 }
 async ledger(ownerId){return {ledger:await this.store.readAll(sql('SELECT event_key,event_type,transaction_key,recorded_ms FROM v10_subscription_events WHERE owner_id=? ORDER BY recorded_ms DESC LIMIT 500',ownerId))};}
}
