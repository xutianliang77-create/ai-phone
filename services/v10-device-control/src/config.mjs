import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {fail,PROFILE} from './common.mjs';
export function configuration(env,now){
 const deploymentId=env.PUBLIC_DEPLOYMENT_ID;if(typeof deploymentId!=='string'||!/^wujie-v10-device-[a-z0-9-]+$/.test(deploymentId))fail('v10_device_deployment_required',503);
 if(env.PUBLIC_BUNDLE_ID!=='cn.qkxy.wujieai.public'||!['Sandbox','Production'].includes(env.BILLING_ENVIRONMENT))fail('v10_billing_configuration_required',503);
 const from=Date.parse(env.V10_SERVICE_WINDOW_STARTS_AT??''),end=Date.parse(env.V10_SERVICE_WINDOW_ENDS_AT??'');
 let admissionOpen=env.V10_DEVICE_LICENSE_ENABLED==='true';
 if(env.V10_SERVICE_WINDOW_STARTS_AT!==undefined||env.V10_SERVICE_WINDOW_ENDS_AT!==undefined)admissionOpen=admissionOpen&&Number.isFinite(from)&&Number.isFinite(end)&&end>from&&end-from<=3600000&&from<=now&&now<end;
 else admissionOpen=admissionOpen&&/^[a-f0-9]{64}$/.test(env.V10_SOURCE_MANIFEST_SHA256??'')&&env.V10_SOURCE_MANIFEST_SHA256===env.V10_RELEASE_APPROVED_SOURCE_SHA256;
 const signerFingerprint=pem=>{try{const key=createPrivateKey(pem);if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')return null;return createHash('sha256').update(createPublicKey(key).export({type:'spki',format:'der'})).digest('hex');}catch{return null;}};
 const fingerprints=[env.APPLE_PRIVATE_KEY_PEM,env.V10_IAP_PRIVATE_KEY_PEM,env.V10_LICENSE_SIGNING_KEY_PEM].map(signerFingerprint);
 const signingReady=fingerprints.every(Boolean)&&new Set(fingerprints).size===3&&
  [env.APPLE_KEY_ID,env.V10_IAP_KEY_ID,env.V10_LICENSE_SIGNING_KEY_ID].every(v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(v))&&
  typeof env.V10_IAP_ISSUER_ID==='string'&&env.V10_IAP_ISSUER_ID.length>0;
 const registrationReady=env.DEVICE_APP_ATTEST_APP_ID===env.APPLE_TEAM_ID+'.'+env.PUBLIC_BUNDLE_ID&&['development','production'].includes(env.DEVICE_APP_ATTEST_ENVIRONMENT);
 const productReady=typeof env.V10_SUBSCRIPTION_PRODUCT_ID==='string'&&/^[A-Za-z0-9._-]{1,160}$/.test(env.V10_SUBSCRIPTION_PRODUCT_ID)&&/^[a-f0-9]{64}$/i.test(env.APPLE_IAP_ROOT_CERT_SHA256??'');
 if(env.PUBLIC_RELEASE_PURPOSE==='A13_QA'&&(!Number.isFinite(from)||!Number.isFinite(end)))admissionOpen=false;
 admissionOpen=admissionOpen&&signingReady&&registrationReady&&productReady;
 return {deploymentId,bundleId:env.PUBLIC_BUNDLE_ID,environment:env.BILLING_ENVIRONMENT,productId:env.V10_SUBSCRIPTION_PRODUCT_ID,requireFreshStatus:true,
  appAppleId:Number(env.V10_APP_APPLE_ID),appleRootSha256:env.APPLE_IAP_ROOT_CERT_SHA256,
  signingKeyId:env.V10_LICENSE_SIGNING_KEY_ID,signingKeyPem:env.V10_LICENSE_SIGNING_KEY_PEM,
  iapIssuerId:env.V10_IAP_ISSUER_ID,iapKeyId:env.V10_IAP_KEY_ID,iapPrivateKeyPem:env.V10_IAP_PRIVATE_KEY_PEM,
  admissionOpen,windowEndMs:Number.isFinite(end)?end:null,qaOwners:env.V10_QA_ALLOWED_ACCOUNT_IDS,profile:PROFILE,
  capabilityProfileV2Enabled:env.V10_CAPABILITY_PROFILE_V2_ENABLED==='true'};
}
export function requireProduct(c){if(typeof c.productId!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(c.productId))fail('v10_subscription_product_not_configured',503);}
export function qaOwnerAllowed(c,id){if(c.windowEndMs===null)return true;try{const a=JSON.parse(c.qaOwners??'[]');return Array.isArray(a)&&a.length<=32&&a.includes(id);}catch{return false;}}
