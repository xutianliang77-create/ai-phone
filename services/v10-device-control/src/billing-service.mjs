import {sql,command} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {deviceProof} from './device-proof.mjs';
import {PURCHASE_DOMAIN,hash,fail,fields,digest} from './common.mjs';
import {requireProduct} from './config.mjs';
export class BillingService{
 constructor(store,config,subscriptions,verifier){this.store=store;this.config=config;this.subscriptions=subscriptions;this.verifier=verifier;}
 async sync(actor,envelope,now){
  requireProduct(this.config);
  const allowed=['domain','ownerId','deploymentId','devicePublicKey','requestKey','issuedAtMs','signedTransactionInfo','storeKitCurrentEntitlement'];
  const p=await deviceProof(this.store,actor,envelope,PURCHASE_DOMAIN,this.config.deploymentId,now,allowed);digest(p.body.requestKey);
  if(typeof p.body.storeKitCurrentEntitlement!=='boolean')fail('v10_storekit_proof_binding');
  const transaction=this.verifier.transaction(p.body.signedTransactionInfo,now);
  const result=await this.subscriptions.sync(actor,transaction,{storeKitCurrentEntitlement:p.body.storeKitCurrentEntitlement},now);
  // A notification may arrive before the customer's first signed sync. Resolve
  // only this now-owned chain; never sweep global legacy work.
  const chain=this.subscriptions.chainKey(transaction),pending=await this.store.readAll(sql('SELECT * FROM v10_subscription_notification_inbox WHERE chain_key=? AND processed_ms IS NULL ORDER BY recorded_ms LIMIT 10',chain));
  for(const n of pending){
   const t=JSON.parse(n.transaction_json);await this.subscriptions.sync({id:actor.id,kind:'system'},t,{},now,n.event_type,n.notification_id);
   await this.markProcessed(n.notification_id,actor.id,now);
  }
  return {status:'recorded',entitlement:await this.subscriptions.entitlement(actor.id,now),transactionId:transaction.transactionId};
 }
 async notification(signed,now){
  requireProduct(this.config);const n=this.verifier.notification(signed,now),t=n.transaction,chain=this.subscriptions.chainKey(t),owner=await this.store.read(sql('SELECT owner_id FROM v10_subscription_chains WHERE chain_key=?',chain));
  const id='v10-apple:'+n.id,c=command(id,owner?.owner_id??'system:apple','v10.subscription.notification',{hash:hash(n.payload)},now);
  await this.store.execute(c,{statements:[sql('INSERT INTO v10_subscription_notification_inbox VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(notification_id) DO NOTHING',id,hash(n.payload),JSON.stringify(t),n.type,chain,now)],receipt:sql("SELECT json_object('status','recorded') AS receipt")});
  if(owner){await this.subscriptions.sync({id:owner.owner_id,kind:'system'},t,{},now,n.type,id);await this.markProcessed(id,owner.owner_id,now);}
  return {status:'recorded'};
 }
 async markProcessed(id,owner,now){await this.store.execute(command(id+':processed',owner,'v10.subscription.notification.processed',{id},now),{statements:[sql('UPDATE v10_subscription_notification_inbox SET processed_ms=COALESCE(processed_ms,?) WHERE notification_id=?',now,id)],receipt:sql("SELECT json_object('status','processed') AS receipt")});}
}
