import {hasCertificateExtension} from './certificate-extensions.mjs';
import {X509Certificate} from 'node:crypto';
import {verifyAppleJwsPayload} from '../../api-server/src/modules/billing/apple-iap-verifier.ts';
import {fail,integer} from './common.mjs';
import {normalizeTransaction} from './subscription-policy.mjs';
// Apple StoreKit signing leaf and WWDR intermediate purpose extensions.
const leafOid=Buffer.from('060a2a864886f76364060b01','hex');
const intermediateOid=Buffer.from('060a2a864886f76364060201','hex');
export function verifiedApplePayload(jws,root,now){
 if(typeof jws!=='string'||jws.length>65536||!/^[a-f0-9]{64}$/i.test(root??''))fail('v10_apple_verification_not_configured',503);
 let header,payload,certs;
 try{const parts=jws.split('.');if(parts.length!==3)throw Error();header=JSON.parse(Buffer.from(parts[0],'base64url').toString());payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());
  if(header.alg!=='ES256'||!Array.isArray(header.x5c)||header.x5c.length<2||header.x5c.length>3)throw Error();
  certs=header.x5c.map(v=>new X509Certificate(Buffer.from(v,'base64')));
 }catch{fail('v10_apple_signature_invalid',403);}
 const signed=integer(payload.signedDate,1);if(signed>now+300000)fail('v10_apple_signed_date',403);
 if(certs[0].ca||!hasCertificateExtension(certs[0].raw,leafOid)||!hasCertificateExtension(certs[1].raw,intermediateOid))fail('v10_apple_certificate_purpose',403);
 for(let i=0;i<certs.length-1;i++)if(!certs[i+1].ca||!certs[i].checkIssued(certs[i+1]))fail('v10_apple_certificate_chain',403);
 const result=verifyAppleJwsPayload({jws,rootCertSha256:root,now:new Date(signed)});
 if(!result.ok)fail('v10_apple_signature_invalid',403);
 return result.payload;
}
export class AppleSubscriptionVerifier{
 constructor(config){this.config=config;}
 transaction(jws,now){return normalizeTransaction(verifiedApplePayload(jws,this.config.appleRootSha256,now),this.config,now);}
 renewal(jws,transaction,now){
  const p=verifiedApplePayload(jws,this.config.appleRootSha256,now);
  if(p.environment!==this.config.environment||p.originalTransactionId!==transaction.originalTransactionId||p.productId!==this.config.productId||![0,1].includes(p.autoRenewStatus)||
    (p.isInBillingRetryPeriod!==undefined&&typeof p.isInBillingRetryPeriod!=='boolean')||
    (p.gracePeriodExpiresDate!==undefined&&!Number.isSafeInteger(p.gracePeriodExpiresDate)))fail('v10_apple_renewal_binding',403);
  return p;
 }
 notification(jws,now){
  const p=verifiedApplePayload(jws,this.config.appleRootSha256,now),d=p.data;
  if(!d||d.bundleId!==this.config.bundleId||d.environment!==this.config.environment||
   (this.config.environment==='Production'&&d.appAppleId!==this.config.appAppleId)||typeof p.notificationUUID!=='string'||typeof p.notificationType!=='string')fail('v10_apple_notification_binding',403);
  const transaction=this.transaction(d.signedTransactionInfo,now);
  const renewal=d.signedRenewalInfo?this.renewal(d.signedRenewalInfo,transaction,now):null;
  return {id:p.notificationUUID,type:p.notificationType,transaction,renewal,payload:p};
 }
}
