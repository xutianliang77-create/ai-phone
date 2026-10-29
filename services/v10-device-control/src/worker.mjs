import {context,authorize} from './environment.mjs';
import {readJson,onlyKeys,GatewayDeviceRegistration,AppAttestVerifier} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {configuration,requireProduct,qaOwnerAllowed} from './config.mjs';
import {COMPONENT_PROFILE,IMPLEMENTATION_HASH} from './component-profile.mjs';
import {SubscriptionRepository} from './subscription-repository.mjs';
import {AppleSubscriptionVerifier} from './apple-subscription-verifier.mjs';
import {BillingService} from './billing-service.mjs';
import {DeviceLicenseService} from './license-service.mjs';
import {accountRoute,deletionAcknowledgement,deletionStatus} from './account.mjs';
import {documents} from './documents.mjs';
import {AppleSubscriptionStatus} from './apple-subscription-status.mjs';
import {fail} from './common.mjs';
import {recoverDeletionOwner,recoverDueDeletions,purgeExpiredDeletionReceipts} from './deletion-recovery.mjs';
import {AppleCertificateRevocationChecker} from './apple-revocation.mjs';
const accountPaths=new Set(['/auth/apple/request','/auth/apple/login','/auth/logout','/account/me','/account/delete','/account/delete/status','/account/export','/account/consents']);
const devicePaths=new Set(['/v10/device/configuration','/v10/device/challenge','/v10/device/register','/v10/device/acquire','/v10/device/renew','/v10/device/close','/v10/device/resolve']);
const billingPaths=new Set(['/billing/products','/billing/entitlement','/billing/ledger','/billing/subscription/sync','/billing/apple/notifications']);
// Status is per certificate pair, never per account. Short-lived in-isolate
// sharing avoids multiplying Apple OCSP requests during simultaneous starts.
const revocationChecker=new AppleCertificateRevocationChecker();
/** Control-only worker; the separate 1.0 deletion queue never scans the historical queue. */
export default {async fetch(request,env,execution){
 const started=Date.now(),url=new URL(request.url),path=url.pathname;let ctx;
 try{
  if(url.origin!=='https://www.beelinkdata.com'||url.search||url.username||url.password)fail('v10_origin_binding',404);
  const config=configuration(env,started);
  if(['/', '/privacy','/terms','/support','/refund','/account/delete','/providers','/permissions'].includes(path)&&['GET','HEAD'].includes(request.method))return documents(env,path,request.method==='HEAD');
  if(path==='/auth/deployment'&&request.method==='GET')return json({deploymentId:config.deploymentId,backend:'cloudflare',bundleId:config.bundleId,execution:'on_device',controlContract:'v10-device-license-v1',componentProfile:COMPONENT_PROFILE.profile});
  if(path==='/health'&&request.method==='GET')return json({service:'wujie-v10-device-control',execution:'on_device',licenseAdmission:config.admissionOpen?'configured_open':'closed'});
  if(!accountPaths.has(path)&&!devicePaths.has(path)&&!billingPaths.has(path))fail('v10_route_not_supported',404);
  const noAccount=path==='/v10/device/close'||path==='/billing/apple/notifications'||path==='/account/delete/status';ctx=await context(env,!noAccount);
  const subscriptions=new SubscriptionRepository(ctx.store,config),billing=new BillingService(ctx.store,config,subscriptions,new AppleSubscriptionVerifier(config,revocationChecker)),licenses=new DeviceLicenseService(ctx.store,config,subscriptions);
  if(path==='/v10/device/close'&&request.method==='POST')return json(await licenses.close(await readJson(request,16384),started),ctx,started);
  if(path==='/billing/apple/notifications'&&request.method==='POST'){const body=await readJson(request,100000);onlyKeys(body,['signedPayload']);return json(await billing.notification(body.signedPayload,started),ctx,started);}
  if(path==='/account/delete/status'&&request.method==='GET')return json(await deletionStatus(ctx,request.headers.get('authorization'),started),ctx,started);
  if(path==='/account/delete'&&request.method==='POST'){const prior=await deletionAcknowledgement(ctx,request.headers.get('authorization'),started);if(prior){if(execution)execution.waitUntil(context(env,true).then(recovery=>recoverDeletionOwner(recovery,prior.account.id,started)));return json(prior,ctx,started);}}
  const publicAccount=path.startsWith('/auth/');const actor=publicAccount?null:await authorize(ctx,request,started);
  if(accountPaths.has(path))return json(await accountRoute(request,env,ctx,config,actor,subscriptions,started,execution),ctx,started);
  if(path==='/billing/products'&&request.method==='GET'){requireProduct(config);return json({products:[{productId:config.productId,kind:'subscription',priceMinorCny:1000,currency:'CNY',period:'P1M',trialDays:7,platform:'apple_iap',purchaseConsentRequired:true,metadataMustMatchStoreKit:true}]},ctx,started);}
  if(path==='/billing/entitlement'&&request.method==='GET'){
   await new AppleSubscriptionStatus(ctx.store,config,subscriptions,new AppleSubscriptionVerifier(config,revocationChecker)).refresh(actor.id,started);
   return json({entitlement:await subscriptions.entitlement(actor.id,started),appAccountToken:actor.account.appAccountToken},ctx,started);
  }
  if(path==='/billing/ledger'&&request.method==='GET')return json(await subscriptions.ledger(actor.id),ctx,started);
  if(path==='/billing/subscription/sync'&&request.method==='POST')return json(await billing.sync(actor,await readJson(request,100000),started),ctx,started);
  if(path==='/v10/device/configuration'&&request.method==='GET')return json({execution:'on_device',deploymentId:config.deploymentId,componentProfile:COMPONENT_PROFILE,implementationHash:IMPLEMENTATION_HASH,licenseAdmission:config.admissionOpen?'configured_open':'closed',maximumOfflineSeconds:1800,serverNowMs:started},ctx,started);
  if(request.method==='POST'&&['/v10/device/challenge','/v10/device/register'].includes(path)){
   const b=await readJson(request,32768),registration=new GatewayDeviceRegistration(ctx.store,new AppAttestVerifier({appId:env.DEVICE_APP_ATTEST_APP_ID,environment:env.DEVICE_APP_ATTEST_ENVIRONMENT}),config.deploymentId);
   if(path.endsWith('/challenge')){onlyKeys(b,['devicePublicKey']);return json(await registration.challenge(actor,b.devicePublicKey,IMPLEMENTATION_HASH,started),ctx,started);}
   return json(await registration.register(actor,b,IMPLEMENTATION_HASH,started),ctx,started);
  }
  if(path==='/v10/device/resolve'&&request.method==='POST')return json(await licenses.resolve(actor,await readJson(request,32768),started),ctx,started);
  if(request.method==='POST'&&['/v10/device/acquire','/v10/device/renew'].includes(path)){
   if(!qaOwnerAllowed(config,actor.id))fail('v10_account_not_in_test_scope',403);
   if(!config.admissionOpen)fail('v10_license_admission_closed',503);
   await new AppleSubscriptionStatus(ctx.store,config,subscriptions,new AppleSubscriptionVerifier(config,revocationChecker)).refresh(actor.id,started);
   const body=await readJson(request,32768);return json(await licenses.issue(actor,body,started),ctx,started);
  }
  fail('v10_route_not_supported',404);
 }catch(error){const code=String(error?.code??error?.message??'');const safe=/^(v10_|apple_|device_|account_|auth_|d1_|gateway_|public_|release_)[a-z0-9_]+$/.test(code)?code:'v10_control_unavailable';
  return json({error:{code:safe,message:'Control operation was not completed'}},ctx,started,error?.status??(/auth_required/.test(safe)?401:/not_ready|not_configured|configuration|unavailable/.test(safe)?503:409));}
},
 async scheduled(_event,env,execution){
  const ctx=await context(env,true);
  execution.waitUntil(recoverDueDeletions(ctx));
  execution.waitUntil(context(env,false).then(other=>purgeExpiredDeletionReceipts(other)));
 }
};
function json(value,ctx,started=Date.now(),status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(ctx?{'server-timing':ctx.budget.timingHeader(Date.now()-started),'x-wujie-d1-calls':String(ctx.budget.databaseCalls)}:{})}});}
