import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,sign,verify,createHash,randomUUID} from 'node:crypto';
const out=path.resolve(process.argv[2]),wrangler=process.argv[3];
const {Miniflare,convertV4MiniflareOptions}=createRequire(wrangler)('miniflare');
const {certificates}=await import(pathToFileURL(path.join(out,'fixture-certificates.mjs')));
const cert=certificates(),now=Date.now(),scope='5YR3BKMQ62:cn.qkxy.wujieai.public',owner='synthetic-runtime-owner',token='SYNTHETIC_LOCAL_TOKEN',appAccountToken=randomUUID();
const issuer=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),device=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),iap=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=device.publicKey.export({format:'jwk'});
const identityKey=generateKeyPairSync('rsa',{modulusLength:2048});let syntheticIdentityJwt='',syntheticIdentityCalls=0;
const identityClientKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const deviceRaw=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
const sha=v=>createHash('sha256').update(v).digest('hex'),envelope=b=>{const d=Buffer.from(JSON.stringify(b));return {clientData:d.toString('base64'),deviceSignature:sign('sha256',d,{key:device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};};
const docs=JSON.parse(fs.readFileSync(path.join(out,'CF_DOCUMENTS_DRAFT.json'),'utf8')),parts=[''];
for(const c of JSON.stringify(docs)){if(Buffer.byteLength(parts.at(-1)+c)>4400)parts.push('');parts[parts.length-1]+=c;}if(parts.length>4)throw Error('document_binding_limit');
const env={PUBLIC_DEPLOYMENT_ID:'wujie-v10-device-runtime',PUBLIC_BUNDLE_ID:'cn.qkxy.wujieai.public',APPLE_TEAM_ID:'5YR3BKMQ62',APPLE_KEY_ID:'SYNTHETIC1',APPLE_PRIVATE_KEY_PEM:identityClientKey.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
 BILLING_ENVIRONMENT:'Sandbox',COMMERCE_WRITER_FENCE:'1',CF_RECOVERY_EPOCH:'1',ACCOUNT_TOKEN_ACTIVE_KEY:'fixture',ACCOUNT_TOKEN_KEYS:JSON.stringify({fixture:'11'.repeat(32)}),APPLE_CREDENTIAL_ACTIVE_KEY:'fixture',APPLE_CREDENTIAL_KEYS:JSON.stringify({fixture:'22'.repeat(32)}),
 PRIVACY_VERSION:docs.privacyVersion,TERMS_VERSION:docs.termsVersion,PUBLIC_RELEASE_PURPOSE:'A13_QA',PUBLIC_DOCUMENT_SET_REVISION:docs.revision,PUBLIC_RELEASE_DOCUMENTS_PART_COUNT:String(parts.length),
 V10_DEVICE_LICENSE_ENABLED:'false',V10_SOURCE_MANIFEST_SHA256:'a'.repeat(64),V10_RELEASE_APPROVED_SOURCE_SHA256:'a'.repeat(64),V10_SUBSCRIPTION_PRODUCT_ID:'fixture.monthly',
 APPLE_IAP_ROOT_CERT_SHA256:cert.root,V10_LICENSE_SIGNING_KEY_ID:'fixture',V10_LICENSE_SIGNING_KEY_PEM:issuer.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
 V10_IAP_ISSUER_ID:'synthetic-issuer',V10_IAP_KEY_ID:'SYNTHETIC2',V10_IAP_PRIVATE_KEY_PEM:iap.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
Object.assign(env,{DEVICE_APP_ATTEST_APP_ID:env.APPLE_TEAM_ID+'.'+env.PUBLIC_BUNDLE_ID,DEVICE_APP_ATTEST_ENVIRONMENT:'development',
 V10_SERVICE_WINDOW_STARTS_AT:new Date(now-1000).toISOString(),V10_SERVICE_WINDOW_ENDS_AT:new Date(now+600000).toISOString(),V10_QA_ALLOWED_ACCOUNT_IDS:JSON.stringify([owner])});
parts.forEach((p,i)=>env['PUBLIC_RELEASE_DOCUMENTS_'+(i+1)]=p);
const transaction={transactionId:'101',originalTransactionId:'100',productId:env.V10_SUBSCRIPTION_PRODUCT_ID,bundleId:env.PUBLIC_BUNDLE_ID,environment:'Sandbox',appAccountToken,type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',purchaseDate:now-1000,expiresDate:now+300000,signedDate:now,currency:'CNY',storefront:'CHN',price:10000};
let syntheticStatusGets=0,externalDenied=0;
const outbound=async request=>{
 const u=new URL(request.url);
 if(u.origin==='https://appleid.apple.com'){
  syntheticIdentityCalls++;
  if(u.pathname==='/auth/keys')return Response.json({keys:[{...identityKey.publicKey.export({format:'jwk'}),kid:'fixture-identity',alg:'RS256',use:'sig'}]});
  if(u.pathname==='/auth/token')return Response.json({id_token:syntheticIdentityJwt,refresh_token:'SYNTHETIC_LOCAL_REFRESH'});
  if(u.pathname==='/auth/revoke')return new Response('',{status:200});
 }
 if(u.origin==='https://api.storekit-sandbox.apple.com'&&u.pathname==='/inApps/v1/subscriptions/100'&&request.method==='GET'){
  syntheticStatusGets++;const t={...transaction,signedDate:Date.now()},r={originalTransactionId:'100',productId:env.V10_SUBSCRIPTION_PRODUCT_ID,environment:'Sandbox',autoRenewStatus:0,signedDate:Date.now()};
  return Response.json({bundleId:env.PUBLIC_BUNDLE_ID,environment:'Sandbox',data:[{lastTransactions:[{originalTransactionId:'100',status:1,signedTransactionInfo:cert.sign(t),signedRenewalInfo:cert.sign(r)}]}]});
 }
 externalDenied++;throw Error('external_network_forbidden');
};
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'wujie-v10-device-runtime-'));fs.copyFileSync(path.join(out,'worker-local.mjs'),path.join(stage,'worker.mjs'));
if(process.env.WUJIE_LOCAL_RUNTIME_DIAGNOSTICS==='1'){
 const p=path.join(stage,'worker.mjs');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('const code = String(error?.code ?? error?.message ?? "");', 'console.error(error?.stack);\n    const code = String(error?.code ?? error?.message ?? "");'));
}
const makeWorker=(name,enabled)=>({name,modulesRoot:stage,modules:[{type:'ESModule',path:path.join(stage,'worker.mjs')}],compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],
 bindings:{...env,V10_DEVICE_LICENSE_ENABLED:enabled?'true':'false'},d1Databases:{D1_COMMERCE:'00000000-0000-0000-0000-000000000011'},outboundService:outbound});
const options=convertV4MiniflareOptions({telemetry:{enabled:false},workers:[makeWorker('closed',false),makeWorker('open',true)]});
if(options.workers.some(w=>w.dev.outboundService?.type!=='fetcher'))throw Error('outbound_guard_not_installed');
const mf=new Miniflare(options),results=[];let db;
const expect=(ok,detail)=>{if(!ok)throw Error(detail);};
async function call(worker,p,method='GET',body,expected=200){
 const r=await worker.fetch('https://www.beelinkdata.com'+p,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
 const type=r.headers.get('content-type')??'',value=type.includes('json')?await r.json():await r.text();
 results.push({path:p,status:r.status,error:value?.error?.code??null});expect(r.status===expected,p+':'+JSON.stringify(value));return value;
}
try{
 db=await mf.getD1Database('D1_COMMERCE','closed');
 const ddl=JSON.parse(fs.readFileSync(path.join(out,'LOCAL_SCHEMA_STATEMENTS.json'),'utf8'));
 for(let i=0;i<ddl.length;i+=20)await db.batch(ddl.slice(i,i+20).map(s=>db.prepare(s)));
 await db.batch([
  db.prepare("INSERT INTO accounts(user_id,app_account_token,status,authorization_epoch,created_ms,updated_ms) VALUES(?,?,'active',1,?,?)").bind(owner,appAccountToken,now,now),
  db.prepare('INSERT INTO usage_accounts VALUES(?,0,0,1,?)').bind(owner,now),
  db.prepare("INSERT INTO identities(identity_key,provider,issuer,scope,subject_hash,user_id,created_ms) VALUES('synthetic-identity','apple','https://appleid.apple.com',?,'synthetic-subject',?,?)").bind(scope,owner,now),
  db.prepare("INSERT INTO apple_credentials VALUES('synthetic-identity',?,'{}',1,?,NULL)").bind(owner,now),
  db.prepare("INSERT INTO account_tokens(token_hash,user_id,identity_key,authorization_epoch,created_ms,expires_ms) VALUES(?,?,'synthetic-identity',1,?,?)").bind(sha('auth-token:'+token),owner,now,now+86400000),
  db.prepare('INSERT INTO device_permit_keys VALUES(?,?,?,?,?,?,0,?,?)').bind(sha(deviceRaw),owner,deviceRaw.toString('base64'),'synthetic-attest-id','synthetic-attest-public','synthetic-attest-receipt',now,now),
 ]);
 const closed=await mf.getWorker('closed'),open=await mf.getWorker('open');
 expect((await call(closed,'/auth/deployment')).execution==='on_device','metadata');
 const challenge=await call(open,'/auth/apple/request','POST',{deploymentId:env.PUBLIC_DEPLOYMENT_ID,action:'login'});
 const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture-identity'})).toString('base64url'),payload=Buffer.from(JSON.stringify({iss:'https://appleid.apple.com',aud:env.PUBLIC_BUNDLE_ID,sub:'SYNTHETIC_LOCAL_SUBJECT',nonce:challenge.nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
 syntheticIdentityJwt=header+'.'+payload+'.'+sign('sha256',Buffer.from(header+'.'+payload),identityKey.privateKey).toString('base64url');
 const loginBody={deploymentId:env.PUBLIC_DEPLOYMENT_ID,challengeId:challenge.challengeId,state:challenge.state,bindingSecret:challenge.bindingSecret,identityToken:syntheticIdentityJwt,authorizationCode:'SYNTHETIC_ONE_USE_CODE',agreements:{privacyAccepted:true,termsAccepted:true,privacyVersion:docs.privacyVersion,termsVersion:docs.termsVersion}};
 const login=await call(open,'/auth/apple/login','POST',loginBody),loginRetry=await call(open,'/auth/apple/login','POST',loginBody);
 expect(login.token===loginRetry.token,'login_replay');
 expect((await call(closed,'/v10/device/configuration')).licenseAdmission==='closed','closed_configuration');
 await call(closed,'/v10/device/acquire','POST',{},503);
 for(const p of ['/translate','/realtime/sessions','/v10/control/authorize','/voice-presets'])await call(open,p,'POST',{},404);
 const html=await call(open,'/privacy');expect(html.includes('手机')&&!html.includes('Hy-MT2'),'privacy_documents');
 const purchase=envelope({domain:'wujie.v10.storekit-proof.v1',ownerId:owner,deploymentId:env.PUBLIC_DEPLOYMENT_ID,devicePublicKey:deviceRaw.toString('base64'),requestKey:'1'.repeat(64),issuedAtMs:Date.now(),signedTransactionInfo:cert.sign(transaction),storeKitCurrentEntitlement:false});
 await call(open,'/billing/subscription/sync','POST',purchase);
 expect((await call(open,'/billing/entitlement')).entitlement.valid===true,'signed_status_entitlement');
 const config=await call(open,'/v10/device/configuration'),request=envelope({domain:'wujie.v10.device-license.request.v1',ownerId:owner,deploymentId:env.PUBLIC_DEPLOYMENT_ID,devicePublicKey:deviceRaw.toString('base64'),requestKey:'2'.repeat(64),launchNonce:'synthetic-launch',profile:config.componentProfile.profile,implementationHash:config.implementationHash,issuedAtMs:Date.now(),operation:'acquire',leaseId:'',sequence:0});
 const a=await call(open,'/v10/device/acquire','POST',request),b=await call(open,'/v10/device/acquire','POST',request);
 const jwt=a.license.split('.');expect(verify('sha256',Buffer.from(jwt[0]+'.'+jwt[1]),{key:issuer.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(jwt[2],'base64url')),'runtime_issuer_signature');
 expect(a.license===b.license&&a.expiresAtMs===transaction.expiresDate,'exact_retry');
 expect((await call(open,'/v10/device/resolve','POST',request)).status==='issued','recover_lost_response');
 const stop=envelope({domain:'wujie.v10.device-license.close.v1',ownerId:owner,deploymentId:env.PUBLIC_DEPLOYMENT_ID,devicePublicKey:deviceRaw.toString('base64'),leaseId:a.leaseId,launchNonce:'synthetic-launch',sequence:1,activeMs:5000,issuedAtMs:Date.now(),reason:'ended'});
 const s=await call(open,'/v10/device/close','POST',stop);await call(open,'/v10/device/close','POST',stop);
 expect(s.chargedSeconds===0,'no_minute_charge');
 const revoked={...transaction,signedDate:Date.now()+1,revocationDate:Date.now()},notification=cert.sign({notificationUUID:'synthetic-refund',notificationType:'REFUND',signedDate:Date.now()+1,data:{bundleId:env.PUBLIC_BUNDLE_ID,environment:'Sandbox',signedTransactionInfo:cert.sign(revoked)}});
 await call(open,'/billing/apple/notifications','POST',{signedPayload:notification});await call(open,'/billing/apple/notifications','POST',{signedPayload:notification});
 expect((await call(open,'/billing/entitlement')).entitlement.valid===false,'refund_revocation');
 const counts={};for(const table of ['v10_device_licenses','v10_device_statistics','v10_subscription_transactions','credit_ledger','credit_reservations'])counts[table]=(await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n;
 expect(counts.v10_device_statistics===1&&counts.credit_ledger===0&&counts.credit_reservations===0,'unique_statistics_no_wallet');
 await call(open,'/account/delete','POST',{});expect((await call(open,'/account/delete','POST',{})).replayed===true,'deletion_ack_replay');
 expect(externalDenied===0,'outbound_denied_attempt');
 fs.writeFileSync(path.join(out,'WORKER_RUNTIME.json'),JSON.stringify({status:'PASS_LOCAL_WORKER_PRODUCTION_ENTRY',workerSha256:sha(fs.readFileSync(path.join(out,'worker-local.mjs'))),diagnosticInstrumentation:process.env.WUJIE_LOCAL_RUNTIME_DIAGNOSTICS==='1',results,counts,syntheticStatusGets,syntheticIdentityCalls,externalDenied,modelsCalled:0,realAppleCalls:0,deployed:false,deviceAccess:false,limits:['Synthetic attested-key seed does not qualify real App Attest','Local D1/workerd does not qualify cloud capacity or phone inference']},null,2));
 console.log(JSON.stringify({status:'PASS',requests:results.length,counts,syntheticStatusGets}));
}catch(error){fs.writeFileSync(path.join(out,'WORKER_RUNTIME_FAILURE.json'),JSON.stringify({error:String(error?.stack??error),results,syntheticStatusGets,externalDenied},null,2));throw error;}
finally{await mf.dispose();cert.close();fs.rmSync(stage,{recursive:true,force:true});}
