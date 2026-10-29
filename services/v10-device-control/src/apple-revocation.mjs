import {createHash,X509Certificate} from 'node:crypto';
import * as asn1 from 'asn1js';
import {Certificate,CertID,OCSPRequest,Request,TBSRequest,OCSPResponse,BasicOCSPResponse,RelativeDistinguishedNames,getCrypto} from 'pkijs';
import {fail} from './common.mjs';

// Check certificate status only after the JWS chain and pinned root have been
// verified. No token, account data, or signed transaction is sent to OCSP.
const skew=60000,maxBytes=131072,maxAge=86400000,cacheMs=60000;
const algorithms=new Set(['1.2.840.10045.4.3.2','1.2.840.10045.4.3.3','1.2.840.10045.4.3.4',
 '1.2.840.113549.1.1.11','1.2.840.113549.1.1.12','1.2.840.113549.1.1.13']);
const sha=v=>createHash('sha256').update(v).digest('hex');
const time=v=>v instanceof Date&&Number.isFinite(v.getTime())?v.getTime():NaN;
function certificate(c){const parsed=asn1.fromBER(c.raw);if(parsed.offset!==c.raw.length)fail('v10_apple_certificate_invalid',403);return new Certificate({schema:parsed.result});}
function endpoint(cert){
 const match=/^OCSP - URI:([^\r\n]+)$/m.exec(cert.infoAccess??'');
 let u;try{u=new URL(match?.[1]);}catch{fail('v10_apple_ocsp_url_invalid',403);}
 if(!['http:','https:'].includes(u.protocol)||!['ocsp.apple.com','ocsp2.apple.com'].includes(u.hostname)||
  u.username||u.password||u.hash||(u.port&&!['80','443'].includes(u.port)))fail('v10_apple_ocsp_url_invalid',403);
 return u.toString();
}
function responderMatches(responder,cert){
 if(responder instanceof RelativeDistinguishedNames)return responder.isEqual(cert.subject);
 if(responder instanceof asn1.OctetString){
  const expected=createHash('sha1').update(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView).digest();
  return Buffer.from(responder.valueBlock.valueHexView).equals(expected);
 }
 return false;
}
function isIssuer(signer,issuer){return signer.subject.isEqual(issuer.subject)&&
 Buffer.from(signer.subjectPublicKeyInfo.toSchema().toBER(false)).equals(Buffer.from(issuer.subjectPublicKeyInfo.toSchema().toBER(false)));}
async function authorizedSigner(basic,issuer,now){
 const candidates=[...(basic.certs??[]),issuer];
 const matches=candidates.filter(c=>responderMatches(basic.tbsResponseData.responderID,c));
 // Ambiguous responder identities cannot be used to select an untrusted cert.
 const usable=[];
 for(const signer of matches){
  if(isIssuer(signer,issuer)){usable.push(signer);continue;}
  const validFrom=time(signer.notBefore.value),validUntil=time(signer.notAfter.value);
  if(!signer.issuer.isEqual(issuer.subject)||!Number.isFinite(validFrom)||!Number.isFinite(validUntil)||validFrom>now+skew||validUntil<now-skew)continue;
  if(signer.extensions?.some(e=>e.critical&&!e.parsedValue))continue;
  const usage=signer.extensions?.find(e=>e.extnID==='2.5.29.15');
  if(usage&&(!usage.parsedValue||(usage.parsedValue.valueBlock.valueHexView[0]&0x80)!==0x80))continue;
  const eku=signer.extensions?.find(e=>e.extnID==='2.5.29.37')?.parsedValue?.keyPurposes;
  if(!Array.isArray(eku)||!eku.includes('1.3.6.1.5.5.7.3.9'))continue;
  try{if(await signer.verify(issuer))usable.push(signer);}catch{}
 }
 // A response commonly embeds the issuer itself; de-duplicate identical keys.
 const unique=new Map(usable.map(c=>[sha(Buffer.from(c.subjectPublicKeyInfo.toSchema().toBER(false))),c]));
 if(unique.size!==1)fail('v10_apple_ocsp_signer_invalid',403);
 return [...unique.values()][0];
}
async function boundedBody(response,limit){
 const declared=Number(response.headers.get('content-length')??0);
 if(!Number.isFinite(declared)||declared>limit)fail('v10_apple_ocsp_response_invalid',403);
 if(!response.body)fail('v10_apple_ocsp_response_invalid',403);
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>limit){await reader.cancel();fail('v10_apple_ocsp_response_invalid',403);}parts.push(value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(parts.map(p=>Buffer.from(p)));
}
export class AppleCertificateRevocationChecker{
 constructor({transport=(url,init)=>fetch(url,init),timeoutMs=4000}={}){this.transport=transport;this.timeoutMs=timeoutMs;this.cache=new Map();this.inflight=new Map();}
 async check(jws,now){
  let certs;
  try{const h=JSON.parse(Buffer.from(jws.split('.')[0],'base64url').toString());
   if(!Array.isArray(h.x5c)||h.x5c.length!==3)throw Error();
   certs=h.x5c.map(v=>new X509Certificate(Buffer.from(v,'base64')));
  }catch{fail('v10_apple_certificate_chain',403);}
  for(const c of certs){const from=Date.parse(c.validFrom),until=Date.parse(c.validTo);
   if(!Number.isFinite(from)||!Number.isFinite(until)||now<from||now>until)fail('v10_apple_certificate_expired',403);}
  await Promise.all([this.checkPair(certs[0],certs[1],now),this.checkPair(certs[1],certs[2],now)]);
 }
 async checkPair(subject,issuer,now){
  const key=sha(subject.raw)+sha(issuer.raw),cached=this.cache.get(key);
  if(cached&&cached.checkedAt<=now&&now<cached.expiresAt)return;
  const existing=this.inflight.get(key);
  if(existing){
   await existing;
   const result=this.cache.get(key);
   if(result&&result.checkedAt<=now&&now<result.expiresAt)return;
  }
  if(this.inflight.size>=64)fail('v10_apple_ocsp_busy',503);
  const work=this.fetchAndCheck(subject,issuer,now,key);this.inflight.set(key,work);
  try{await work;}finally{if(this.inflight.get(key)===work)this.inflight.delete(key);}
 }
 async fetchAndCheck(subject,issuer,now,key){
  const target=certificate(subject),issuerCert=certificate(issuer),id=new CertID();
  await id.createForCertificate(target,{hashAlgorithm:'SHA-256',issuerCertificate:issuerCert});
  const request=new OCSPRequest({tbsRequest:new TBSRequest({requestList:[new Request({reqCert:id})]})});
  const body=Buffer.from(request.toSchema(true).toBER(false));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  let bytes;
  try{
   const res=await this.transport(endpoint(subject),{method:'POST',redirect:'manual',signal:controller.signal,
    headers:{'content-type':'application/ocsp-request','accept':'application/ocsp-response'},body});
   if(!res.ok)fail('v10_apple_ocsp_unavailable',503);
   bytes=await boundedBody(res,maxBytes);
  }catch(error){if(error?.code)throw error;fail('v10_apple_ocsp_unavailable',503);}
  finally{clearTimeout(timer);}
  let basic;
  try{
   const decoded=asn1.fromBER(bytes);if(decoded.offset!==bytes.length)throw Error();
   const response=new OCSPResponse({schema:decoded.result});
   if(response.responseStatus.valueBlock.valueDec!==0||response.responseBytes?.responseType!=='1.3.6.1.5.5.7.48.1.1')throw Error();
   basic=BasicOCSPResponse.fromBER(response.responseBytes.response.valueBlock.valueHexView);
  }catch{fail('v10_apple_ocsp_response_invalid',403);}
  const produced=time(basic.tbsResponseData.producedAt),responses=basic.tbsResponseData.responses.filter(r=>r.certID.isEqual(id));
  if(!Number.isFinite(produced)||produced>now+skew||produced<now-maxAge||responses.length!==1||!algorithms.has(basic.signatureAlgorithm.algorithmId))
   fail('v10_apple_ocsp_response_invalid',403);
  const entry=responses[0],thisUpdate=time(entry.thisUpdate),nextUpdate=time(entry.nextUpdate);
  if(!Number.isFinite(thisUpdate)||!Number.isFinite(nextUpdate)||thisUpdate>now+skew||thisUpdate<now-maxAge||nextUpdate<now-skew||
   nextUpdate<thisUpdate||produced<thisUpdate-skew)fail('v10_apple_ocsp_stale',403);
  if(entry.certStatus.idBlock.tagClass!==3||entry.certStatus.idBlock.tagNumber!==0||entry.certStatus.idBlock.isConstructed)
   fail('v10_apple_certificate_revoked_or_unknown',403);
  const signer=await authorizedSigner(basic,issuerCert,now);
  // The exact issuer is already chained to the pinned root by the caller;
  // delegated responders were checked as directly issued and OCSP-capable.
  try{if(!await getCrypto(true).verifyWithPublicKey(basic.tbsResponseData.tbsView,basic.signature,
    signer.subjectPublicKeyInfo,basic.signatureAlgorithm))throw Error();}
  catch{fail('v10_apple_ocsp_signature_invalid',403);}
  if(this.cache.size>=64)this.cache.clear();
  this.cache.set(key,{checkedAt:now,expiresAt:Math.min(now+cacheMs,nextUpdate)});
 }
}
