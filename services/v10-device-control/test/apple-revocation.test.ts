import {afterAll,expect,it} from 'vitest';
import {certificates} from './apple-certificate-fixture.js';
import {AppleCertificateRevocationChecker} from '../src/apple-revocation.mjs';
import * as asn1 from 'asn1js';
import {OCSPResponse,BasicOCSPResponse} from 'pkijs';
import {AppleSubscriptionVerifier} from '../src/apple-subscription-verifier.mjs';

const cert=certificates(),now=Date.now();afterAll(()=>cert.close());
const jws=cert.sign({signedDate:now});
function transport(status:'good'|'revoked'='good'){
 return async (url:string,init:RequestInit)=>{
  const key=url.endsWith('/leaf')?'leaf':'intermediate';
  const result=cert.ocsp(key,Buffer.from(init.body as Uint8Array),key==='leaf'?status:'good');
  return new Response(result,{status:200,headers:{'content-type':'application/ocsp-response'}});
 };
}
it('accepts freshly signed GOOD status for both certificates and caches only briefly',async()=>{
 let calls=0;const good=transport();
 const checker=new AppleCertificateRevocationChecker({transport:async(u:string,i:RequestInit)=>{calls++;return good(u,i)}});
 await Promise.all(Array.from({length:10},()=>checker.check(jws,now)));expect(calls).toBe(2);
 await checker.check(jws,now+1000);expect(calls).toBe(2);
 await checker.check(jws,now+61000);expect(calls).toBe(4);
});
it('rejects revoked, stale, corrupt, unknown and unavailable status without granting',async()=>{
 await expect(new AppleCertificateRevocationChecker({transport:transport('revoked')}).check(jws,now))
  .rejects.toThrow('v10_apple_certificate_revoked_or_unknown');
 await expect(new AppleCertificateRevocationChecker({transport:transport()}).check(jws,now+2*86400000))
  .rejects.toThrow('v10_apple_ocsp');
 const good=transport();
 await expect(new AppleCertificateRevocationChecker({transport:async(u:string,i:RequestInit)=>{
  const r=await good(u,i),b=Buffer.from(await r.arrayBuffer());
  const response=new OCSPResponse({schema:asn1.fromBER(b).result});
  const basic=BasicOCSPResponse.fromBER(response.responseBytes!.response.valueBlock.valueHexView);
  const signature=Buffer.from(basic.signature.valueBlock.valueHexView),offset=b.indexOf(signature);
  if(offset<0)throw Error('fixture signature missing');b[offset+4]^=1;
  return new Response(b);
 }}).check(jws,now)).rejects.toThrow('v10_apple_ocsp');
 await expect(new AppleCertificateRevocationChecker({transport:async()=>new Response('unavailable',{status:503})}).check(jws,now))
  .rejects.toThrow('v10_apple_ocsp_unavailable');
});
it('bounds stalled network requests and rejects untrusted endpoints',async()=>{
 const checker=new AppleCertificateRevocationChecker({timeoutMs:20,transport:async(_u:string,init:RequestInit)=>new Promise((_resolve,reject)=>
  init.signal?.addEventListener('abort',()=>reject(Object.assign(Error('timeout'),{name:'AbortError'}))))});
 await expect(checker.check(jws,now)).rejects.toThrow('v10_apple_ocsp_unavailable');
 const hostile=certificates(true,'127.0.0.1');
 try{let calls=0;const bounded=new AppleCertificateRevocationChecker({transport:async()=>{calls++;return new Response()}}),later=Date.now();
  await expect(bounded.check(hostile.sign({signedDate:later}),later)).rejects.toThrow('v10_apple_ocsp_url_invalid');
  expect(calls).toBe(0);
 }finally{hostile.close();}
});

it('accepts an issuer-signed OCSP responder only with OCSP signing purpose',async()=>{
 const checker=(purpose:'valid'|'invalid'|'wrongusage')=>new AppleCertificateRevocationChecker({transport:async(u:string,i:RequestInit)=>{
  const key=u.endsWith('/leaf')?'leaf':'intermediate';
  return new Response(cert.ocsp(key,Buffer.from(i.body as Uint8Array),'good',purpose));
 }});
 await checker('valid').check(jws,now);
 await expect(checker('invalid').check(jws,now)).rejects.toThrow('v10_apple_ocsp_signer_invalid');
 await expect(checker('wrongusage').check(jws,now)).rejects.toThrow('v10_apple_ocsp_signer_invalid');
});

it('the product verifier requires status after signature and before granting',async()=>{
 const config={productId:'fixture.monthly',bundleId:'fixture.bundle',environment:'Sandbox',appleRootSha256:cert.root};
 const t={transactionId:'10001',originalTransactionId:'10000',type:'Auto-Renewable Subscription',
  inAppOwnershipType:'PURCHASED',purchaseDate:now-1000,expiresDate:now+600000,signedDate:now,
  offerType:1,offerDiscountType:'FREE_TRIAL',price:0,currency:'CNY',storefront:'CHN',...config};
 const verifier=new AppleSubscriptionVerifier(config,new AppleCertificateRevocationChecker({transport:transport()}));
 expect((await verifier.transaction(cert.sign(t),now)).kind).toBe('trial');
 let calls=0;
 const wrongRoot=new AppleSubscriptionVerifier({...config,appleRootSha256:'a'.repeat(64)},
  new AppleCertificateRevocationChecker({transport:async()=>{calls++;return new Response()}}));
 await expect(wrongRoot.transaction(cert.sign(t),now)).rejects.toThrow('v10_apple_signature_invalid');
 expect(calls).toBe(0);
});
