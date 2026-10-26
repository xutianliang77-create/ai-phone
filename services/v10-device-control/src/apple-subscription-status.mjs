import {sign,createPrivateKey} from 'node:crypto';
import {sql,command} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash,fail} from './common.mjs';
/** Fresh, read-only Apple status. Separate IAP credentials; never the Apple
 * login key or device-license issuer. One bounded GET reconnect, no purchase. */
export class AppleSubscriptionStatus {
 constructor(store,config,subscriptions,verifier,transport=(input,init)=>fetch(input,init)){Object.assign(this,{store,config,subscriptions,verifier,transport});}
 async refresh(owner,now){
  const chains=await this.store.readAll(sql('SELECT c.*,s.verified_ms FROM v10_subscription_chains c LEFT JOIN v10_subscription_status s ON s.chain_key=c.chain_key WHERE c.owner_id=? ORDER BY c.updated_ms DESC LIMIT 2',owner));
  for(const chain of chains){
   if(chain.verified_ms!==null&&chain.verified_ms!==undefined&&chain.verified_ms<=now&&now-chain.verified_ms<60000)continue;
   const body=await this.read(chain.original_transaction_id,now);
   if(body.bundleId!==this.config.bundleId||body.environment!==this.config.environment||
     (this.config.environment==='Production'&&body.appAppleId!==this.config.appAppleId))fail('v10_apple_status_binding',403);
   let found=false;
   for(const group of body.data??[])for(const item of group.lastTransactions??[]){
    if(item.originalTransactionId!==chain.original_transaction_id)continue;
    if(found||![1,2,3,4,5].includes(item.status))fail('v10_apple_status_binding');found=true;
    const t=this.verifier.transaction(item.signedTransactionInfo,now),r=this.verifier.renewal(item.signedRenewalInfo,t,now);
    if(t.originalTransactionId!==chain.original_transaction_id||t.signedAtMs<now-300000||r.signedDate<now-300000)fail('v10_apple_status_stale');
    await this.subscriptions.sync({id:owner,kind:'system'},t,{},now,'apple_status');
    await this.record(owner,chain.chain_key,item.status,r,now,hash([t.payloadHash,r]));
   }
   if(!found)fail('v10_apple_status_missing');
  }
 }
 async record(owner,chain,status,r,now,payloadHash){
  const c=command('v10-status:'+hash([chain,payloadHash,status,now]),owner,'v10.subscription.status',{chain,payloadHash,status},now);
  await this.store.execute(c,{statements:[sql(`INSERT INTO v10_subscription_status VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(chain_key) DO UPDATE
   SET verified_ms=excluded.verified_ms,signed_ms=excluded.signed_ms,status=excluded.status,auto_renew=excluded.auto_renew,billing_retry=excluded.billing_retry,grace_expires_ms=excluded.grace_expires_ms,payload_hash=excluded.payload_hash
   WHERE excluded.signed_ms>=v10_subscription_status.signed_ms`,chain,owner,now,r.signedDate,status,r.autoRenewStatus,r.isInBillingRetryPeriod===true?1:0,r.gracePeriodExpiresDate??null,payloadHash)],receipt:sql("SELECT json_object('status','recorded') AS receipt")});
 }
 authorization(now){
  const c=this.config;if(!c.iapIssuerId||!c.iapKeyId||!c.iapPrivateKeyPem)fail('v10_iap_status_not_configured',503);
  const key=createPrivateKey(c.iapPrivateKeyPem);if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')fail('v10_iap_key_invalid',503);
  const h=Buffer.from(JSON.stringify({alg:'ES256',kid:c.iapKeyId,typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:c.iapIssuerId,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+60,aud:'appstoreconnect-v1',bid:c.bundleId})).toString('base64url');
  return h+'.'+b+'.'+sign('sha256',Buffer.from(h+'.'+b),{key:c.iapPrivateKeyPem,dsaEncoding:'ieee-p1363'}).toString('base64url');
 }
 async read(transactionId,now){
  if(!/^[0-9]{1,80}$/.test(transactionId))fail('v10_apple_transaction_identifier');
  const origin=this.config.environment==='Sandbox'?'https://api.storekit-sandbox.apple.com':'https://api.storekit.apple.com',authorization=this.authorization(now);
  for(let attempt=0;attempt<2;attempt++){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
   try{
    const response=await this.transport(origin+'/inApps/v1/subscriptions/'+transactionId,{method:'GET',redirect:'manual',headers:{authorization:'Bearer '+authorization},signal:controller.signal});
    if(attempt===0&&[502,503,504].includes(response.status)){await response.body?.cancel();continue;}
    if(!response.ok)fail('v10_apple_status_unavailable',503);
    let bytes=0,text='';const decoder=new TextDecoder();for await(const part of response.body){bytes+=part.byteLength;if(bytes>524288)fail('v10_apple_status_response_size');text+=decoder.decode(part,{stream:true});}
    text+=decoder.decode();return JSON.parse(text);
   }catch(error){if(attempt===0&&(error.name==='AbortError'||error instanceof TypeError))continue;throw error;}
   finally{clearTimeout(timer);}
  }
  fail('v10_apple_status_unavailable',503);
 }
}
