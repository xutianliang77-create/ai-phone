import {it,expect,afterAll} from 'vitest';
import {certificates} from './apple-certificate-fixture.js';
import {AppleSubscriptionVerifier,verifiedApplePayload} from '../src/apple-subscription-verifier.mjs';
const good=certificates(),bad=certificates(false),now=Date.now();afterAll(()=>{good.close();bad.close();});
const c={productId:'fixture.monthly',bundleId:'cn.qkxy.wujieai.public',environment:'Sandbox',appleRootSha256:good.root};
const payload={...c,transactionId:'10001',originalTransactionId:'10000',type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',
 purchaseDate:now-1000,expiresDate:now+604800000,signedDate:now,offerType:1,offerDiscountType:'FREE_TRIAL',price:0,currency:'CNY',storefront:'CHN'};
it('verifies a purpose-pinned signature and derives exact signed trial dates',()=>{
 expect(new AppleSubscriptionVerifier(c).transaction(good.sign(payload),now)).toMatchObject({kind:'trial',expiresAtMs:payload.expiresDate});
});
it('rejects wrong root, wrong signing purpose, bad signature and future signed time',()=>{
 expect(()=>verifiedApplePayload(good.sign(payload),'a'.repeat(64),now)).toThrow();
 expect(()=>verifiedApplePayload(bad.sign(payload),bad.root,now)).toThrow('v10_apple_certificate_purpose');
 const token=good.sign(payload),parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({...payload,expiresDate:now+1e9})).toString('base64url');
 expect(()=>verifiedApplePayload(parts.join('.'),good.root,now)).toThrow();
 expect(()=>verifiedApplePayload(good.sign({...payload,signedDate:now+300001}),good.root,now)).toThrow();
});
it('verifies both notification and inner transaction bindings',()=>{
 const inner=good.sign(payload),outer=good.sign({notificationUUID:'fixture-1',notificationType:'SUBSCRIBED',signedDate:now,data:{bundleId:c.bundleId,environment:'Sandbox',signedTransactionInfo:inner}});
 expect(new AppleSubscriptionVerifier(c).notification(outer,now).transaction.kind).toBe('trial');
 expect(()=>new AppleSubscriptionVerifier({...c,environment:'Production',appAppleId:123}).notification(outer,now)).toThrow('v10_apple_notification_binding');
});
