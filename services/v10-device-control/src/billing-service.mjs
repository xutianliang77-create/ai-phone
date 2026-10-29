import {sql,command} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {deviceProof} from './device-proof.mjs';
import {PURCHASE_DOMAIN,hash,fail,fields,digest} from './common.mjs';
import {requireProduct} from './config.mjs';
import {AppleSubscriptionStatus} from './apple-subscription-status.mjs';
export class BillingService{
 constructor(store,config,subscriptions,verifier,{statusFactory}={}){this.store=store;this.config=config;this.subscriptions=subscriptions;this.verifier=verifier;
  this.statusFactory=statusFactory??(()=>new AppleSubscriptionStatus(store,config,subscriptions,verifier));}
 async sync(actor,envelope,now){
  requireProduct(this.config);
  const allowed=['domain','ownerId','deploymentId','devicePublicKey','requestKey','issuedAtMs','signedTransactionInfo','storeKitCurrentEntitlement'];
  const p=await deviceProof(this.store,actor,envelope,PURCHASE_DOMAIN,this.config.deploymentId,now,[...allowed,'userInitiatedRestore','targetAccountToken'],30000,allowed);digest(p.body.requestKey);
  if(typeof p.body.storeKitCurrentEntitlement!=='boolean')fail('v10_storekit_proof_binding');
  if(p.body.userInitiatedRestore!==undefined&&typeof p.body.userInitiatedRestore!=='boolean')fail('v10_storekit_proof_binding');
  if(p.body.userInitiatedRestore===true){
   const account=await this.store.read(sql("SELECT app_account_token FROM accounts WHERE user_id=? AND status='active'",actor.id));
   if(typeof p.body.targetAccountToken!=='string'||!account||p.body.targetAccountToken!==account.app_account_token.toLowerCase())
    fail('v10_restore_account_generation_mismatch',403);
  }else if(p.body.targetAccountToken!==undefined)fail('v10_storekit_proof_binding');
  const transaction=await this.verifier.transaction(p.body.signedTransactionInfo,now);
  const chain=this.subscriptions.chainKey(transaction),existing=await this.store.read(sql('SELECT owner_id FROM v10_subscription_chains WHERE chain_key=?',chain));
  let ownershipTransferred=false;
  if(existing&&existing.owner_id!==actor.id){
   if(p.body.storeKitCurrentEntitlement!==true||p.body.userInitiatedRestore!==true)fail('v10_restore_user_proof_required',403);
   const evidence=await this.statusFactory().activeRestoreEvidence(transaction.originalTransactionId,now);
   const committedAt=Math.max(now,Date.now());
   await this.subscriptions.restoreAfterDeletion(actor,transaction,evidence,p.dataHash,committedAt);
   ownershipTransferred=true;
  }else await this.subscriptions.sync(actor,transaction,{storeKitCurrentEntitlement:p.body.storeKitCurrentEntitlement},now);
  // A notification may arrive before the customer's first signed sync. Resolve
  // only this now-owned chain; never sweep global legacy work.
  const pending=await this.store.readAll(sql('SELECT * FROM v10_subscription_notification_inbox WHERE chain_key=? AND processed_ms IS NULL ORDER BY recorded_ms LIMIT 10',chain));
  for(const n of pending){
   const t=JSON.parse(n.transaction_json);await this.subscriptions.sync({id:actor.id,kind:'system'},t,{},now,n.event_type,n.notification_id);
   await this.markProcessed(n.notification_id,actor.id,now);
  }
  return {status:'recorded',entitlement:await this.subscriptions.entitlement(actor.id,Math.max(now,Date.now())),transactionId:transaction.transactionId,ownershipTransferred,
   restoreAcknowledged:p.body.userInitiatedRestore===true&&p.body.storeKitCurrentEntitlement===true};
 }
 async notification(signed,now){
  requireProduct(this.config);const n=await this.verifier.notification(signed,now);
  if(n.type==='TEST')return {status:'recorded',test:true};
  const t=n.transaction,chain=this.subscriptions.chainKey(t),owner=await this.store.read(sql('SELECT owner_id FROM v10_subscription_chains WHERE chain_key=?',chain));
  const id='v10-apple:'+n.id,c=command(id,owner?.owner_id??'system:apple','v10.subscription.notification',{hash:hash(n.payload)},now);
  await this.store.execute(c,{statements:[sql('INSERT INTO v10_subscription_notification_inbox VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(notification_id) DO NOTHING',id,hash(n.payload),JSON.stringify(t),n.type,chain,now)],receipt:sql("SELECT json_object('status','recorded') AS receipt")});
  if(owner){await this.subscriptions.sync({id:owner.owner_id,kind:'system'},t,{},now,n.type,id);await this.markProcessed(id,owner.owner_id,now);}
  return {status:'recorded'};
 }
 async markProcessed(id,owner,now){await this.store.execute(command(id+':processed',owner,'v10.subscription.notification.processed',{id},now),{statements:[sql('UPDATE v10_subscription_notification_inbox SET processed_ms=COALESCE(processed_ms,?) WHERE notification_id=?',now,id)],receipt:sql("SELECT json_object('status','processed') AS receipt")});}
}
