import {it,expect,afterAll,afterEach} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {certificates} from './apple-certificate-fixture.js';
import {setup} from './control-fixture.js';
import {normalizeTransaction} from '../src/subscription-policy.mjs';
import {AppleSubscriptionVerifier} from '../src/apple-subscription-verifier.mjs';
import {AppleSubscriptionStatus} from '../src/apple-subscription-status.mjs';
const cert=certificates(),now=Date.now();afterAll(()=>cert.close());
let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
async function statusFixture(){
 ctx=setup();ctx.config.bundleId='cn.qkxy.wujieai.public';ctx.config['requireFreshStatus']=true;
 const u=await ctx.owner('alice'),key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 ctx.config['appleRootSha256']=cert.root;ctx.config['iapIssuerId']='fixture-issuer';ctx.config['iapKeyId']='fixture-iap-key';ctx.config['iapPrivateKeyPem']=key.privateKey.export({type:'pkcs8',format:'pem'}).toString();
 const p={productId:ctx.config.productId,bundleId:ctx.config.bundleId,environment:'Sandbox',transactionId:'101',originalTransactionId:'100',appAccountToken:u.user.appAccountToken,
  type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',purchaseDate:now-1000,expiresDate:now+1800000,signedDate:now,currency:'CNY',storefront:'CHN',price:10000};
 await ctx.subscriptions().sync(u.actor,normalizeTransaction(p,ctx.config,now),{},now);
 // The helper also seeded a different, intentionally stale chain. Keep this
 // test scoped to the numeric App Store chain created above.
 ctx.f.db.prepare('DELETE FROM v10_subscription_transactions WHERE transaction_key<>?').run(ctx.subscriptions().transactionKey(normalizeTransaction(p,ctx.config,now)));
 ctx.f.db.prepare('DELETE FROM v10_subscription_chains WHERE original_transaction_id<>?').run('100');
 const r={environment:'Sandbox',productId:ctx.config.productId,originalTransactionId:'100',signedDate:now,autoRenewStatus:0,isInBillingRetryPeriod:false};
 const response=(status=1)=>({bundleId:ctx.config.bundleId,environment:'Sandbox',data:[{lastTransactions:[{originalTransactionId:'100',status,signedTransactionInfo:cert.sign(p),signedRenewalInfo:cert.sign(r)}]}]});
 return {u,p,r,response,verifier:new AppleSubscriptionVerifier(ctx.config,{check:async()=>{}})};
}
it('refreshes signed status via GET only; cancellation preserves the paid period and fresh cache avoids another request',async()=>{
 const f=await statusFixture();let calls=0;
 const service=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),f.verifier,async(url,options)=>{
  calls++;expect(url).toBe('https://api.storekit-sandbox.apple.com/inApps/v1/subscriptions/100');expect(options.method).toBe('GET');
  const token=options.headers.authorization.slice(7).split('.');expect(JSON.parse(Buffer.from(token[1],'base64url').toString())).toMatchObject({aud:'appstoreconnect-v1',bid:ctx.config.bundleId});
  return Response.json(f.response());
 });
 expect((await ctx.subscriptions().entitlement('alice',now)).valid).toBe(false);
 await service.refresh('alice',now);expect((await ctx.subscriptions().entitlement('alice',now)).valid).toBe(true);
 await service.refresh('alice',now+1);expect(calls).toBe(1);expect(ctx.count('credit_ledger')).toBe(0);
});
it('performs at most one reconnect for a read-only transient failure and never retries permission denial',async()=>{
 const f=await statusFixture();let calls=0;
 const service=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),f.verifier,async()=>{calls++;return calls===1?new Response('',{status:503}):Response.json(f.response());});
 await service.refresh('alice',now);expect(calls).toBe(2);
 calls=0;const denied=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),f.verifier,async()=>{calls++;return new Response('',{status:401});});
 await expect(denied.read('100',now)).rejects.toThrow('v10_apple_status_unavailable');expect(calls).toBe(1);
});
it('a verified revoked status fences a transaction even without a notification; stale refresh never grants grace',async()=>{
 const f=await statusFixture();
 const service=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),f.verifier,async()=>Response.json(f.response(5)));
 await service.refresh('alice',now);expect((await ctx.subscriptions().entitlement('alice',now)).valid).toBe(false);
 expect((await ctx.subscriptions().entitlement('alice',now+60000)).valid).toBe(false);
});
it('accepts an older valid signed transaction returned by a fresh authenticated status response',async()=>{
 const f=await statusFixture();
 const old={...normalizeTransaction(f.p,ctx.config,now),signedAtMs:now-301000};
 const verifier={transaction:()=>old,renewal:()=>f.r} as unknown as AppleSubscriptionVerifier;
 const service=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),verifier,async()=>Response.json(f.response()));
 await service.refresh('alice',now);
 expect((await ctx.subscriptions().entitlement('alice',now)).valid).toBe(true);
});
it('restore requires exactly one fresh Apple status and an active period or signed grace',async()=>{
 const f=await statusFixture();let payload=f.response();
 const service=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),f.verifier,async()=>Response.json(payload));
 expect((await service.activeRestoreEvidence('100',now)).status).toBe(1);
 payload=f.response(3);await expect(service.activeRestoreEvidence('100',now)).rejects.toThrow('v10_restore_entitlement_not_active');
 payload=f.response(5);await expect(service.activeRestoreEvidence('100',now)).rejects.toThrow('v10_restore_entitlement_not_active');
 const expired={...f.p,expiresDate:now-1},grace={...f.r,gracePeriodExpiresDate:now+300000};
 payload={bundleId:ctx.config.bundleId,environment:'Sandbox',data:[{lastTransactions:[{originalTransactionId:'100',status:4,
  signedTransactionInfo:cert.sign(expired),signedRenewalInfo:cert.sign(grace)}]}]};
 expect((await service.activeRestoreEvidence('100',now)).status).toBe(4);
 payload.data[0].lastTransactions.push(payload.data[0].lastTransactions[0]);
 await expect(service.activeRestoreEvidence('100',now)).rejects.toThrow('v10_restore_entitlement_not_active');
});
