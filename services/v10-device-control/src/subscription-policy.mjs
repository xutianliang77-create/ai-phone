import {fail,id,integer,hash} from './common.mjs';
/** Signed Apple transaction price is in milliunits, not cents. CNY10 = 10000.
 * Trial and sandbox periods use Apple's signed timestamps, never phone dates. */
export function normalizeTransaction(p,config,now){
 if(!p||typeof p!=='object'||p.productId!==config.productId||p.bundleId!==config.bundleId||p.environment!==config.environment||p.type!=='Auto-Renewable Subscription'||p.inAppOwnershipType!=='PURCHASED')fail('v10_subscription_binding');
 const purchased=integer(p.purchaseDate,1),expires=integer(p.expiresDate,1),signed=integer(p.signedDate,1);
 if(expires<=purchased||signed>now+300000||purchased>signed+300000)fail('v10_subscription_dates');
 if(p.currency!=='CNY'||p.storefront!=='CHN')fail('v10_subscription_storefront');
 const trial=p.offerType===1&&p.offerDiscountType==='FREE_TRIAL';
 if(trial?p.price!==0:p.price!==10000)fail('v10_subscription_price');
 if(!trial&&p.offerType!==undefined)fail('v10_subscription_offer_not_configured');
 if(p.appAccountToken!==undefined&&(typeof p.appAccountToken!=='string'||!uuid(p.appAccountToken)))fail('v10_subscription_account_token');
 if(p.revocationDate!==undefined)integer(p.revocationDate,1);
 return {transactionId:id(p.transactionId),originalTransactionId:id(p.originalTransactionId),productId:p.productId,bundleId:p.bundleId,environment:p.environment,
  appAccountToken:p.appAccountToken?.toLowerCase()??null,startsAtMs:purchased,expiresAtMs:expires,signedAtMs:signed,
  revokedAtMs:p.revocationDate??null,kind:trial?'trial':'paid',priceMilli:p.price,currency:'CNY',storefront:'CHN',payloadHash:hash(p)};
}
export function uuid(v){return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);}
export function currentEntitlement(rows,now){
 const expiry=r=>r.apple_status===4&&Number.isSafeInteger(r.grace_expires_ms)&&r.grace_expires_ms>r.expires_ms&&
  Number.isSafeInteger(r.status_verified_ms)&&r.status_verified_ms>now-60000&&r.status_verified_ms<=now?r.grace_expires_ms:r.expires_ms;
 const active=rows.filter(r=>r.starts_ms<=now&&expiry(r)>now&&(r.revoked_ms===null||r.revoked_ms===undefined));
 active.sort((a,b)=>expiry(b)-expiry(a)||b.signed_ms-a.signed_ms||String(a.transaction_key).localeCompare(b.transaction_key));
 const r=active[0];
 if(r)return {status:expiry(r)>r.expires_ms?'grace':r.period_kind==='trial'?'trialing':'active',valid:true,startsAtMs:r.starts_ms,expiresAtMs:expiry(r),transactionKey:r.transaction_key,revisionHash:hash(active.map(x=>[x.transaction_key,x.signed_ms,x.expires_ms,x.apple_status??null,x.grace_expires_ms??null,x.status_verified_ms??null]))};
 if(!rows.length)return {status:'not_subscribed',valid:false};
 const latest=[...rows].sort((a,b)=>b.signed_ms-a.signed_ms)[0];
 return {status:latest.revoked_ms?'revoked':'expired',valid:false,expiresAtMs:latest.expires_ms};
}
