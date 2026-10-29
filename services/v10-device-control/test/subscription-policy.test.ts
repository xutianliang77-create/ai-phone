import {it,expect} from 'vitest';
import {normalizeTransaction,currentEntitlement} from '../src/subscription-policy.mjs';
const now=1800000000000,config={productId:'fixture.monthly',bundleId:'com.example.phone',environment:'Sandbox'};
const base={...config,type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',transactionId:'t1',originalTransactionId:'o1',purchaseDate:now-1000,expiresDate:now+10000,signedDate:now,currency:'CNY',storefront:'CHN',price:10000};
it('CNY10 is 10000 signed milliunits, not 1000 cents or 10 units',()=>{
 expect(normalizeTransaction(base,config,now)).toMatchObject({kind:'paid',priceMilli:10000});
 for(const price of [10,1000,10001])expect(()=>normalizeTransaction({...base,price},config,now)).toThrow('v10_subscription_price');
});
it('uses signed trial end including sandbox acceleration; it never locally adds seven days',()=>{
 const t=normalizeTransaction({...base,offerType:1,offerDiscountType:'FREE_TRIAL',price:0},config,now);expect(t.kind).toBe('trial');expect(t.expiresAtMs).toBe(base.expiresDate);
});
it('has no seconds balance prerequisite for an active period, and ends at equality',()=>{
 const row={transaction_key:'t1',period_kind:'trial',starts_ms:now-1,expires_ms:now+1,signed_ms:now,revoked_ms:null};
 expect(currentEntitlement([row],now)).toMatchObject({valid:true,status:'trialing'});expect(currentEntitlement([row],now+1).valid).toBe(false);
 expect(currentEntitlement([{...row,revoked_ms:now}],now)).toMatchObject({valid:false,status:'revoked'});
});
it('honors a verified billing grace deadline and stops exactly when it ends',()=>{
 const row={transaction_key:'t1',period_kind:'paid',starts_ms:now-10000,expires_ms:now-1,
  signed_ms:now-1000,revoked_ms:null,apple_status:4,status_verified_ms:now,grace_expires_ms:now+1000};
 expect(currentEntitlement([row],now)).toMatchObject({valid:true,status:'grace',expiresAtMs:now+1000});
 expect(currentEntitlement([row],now+1000).valid).toBe(false);
 expect(currentEntitlement([{...row,status_verified_ms:now-60000}],now).valid).toBe(false);
 expect(currentEntitlement([{...row,apple_status:1}],now).valid).toBe(false);
 expect(currentEntitlement([{...row,revoked_ms:now}],now).valid).toBe(false);
});
it('rejects wrong SKU, environment, currency and invalid intervals before ledger changes',()=>{
 for(const patch of [{productId:'other'},{environment:'Production'},{currency:'USD'},{expiresDate:now-2000},{price:0}])expect(()=>normalizeTransaction({...base,...patch},config,now)).toThrow();
});
