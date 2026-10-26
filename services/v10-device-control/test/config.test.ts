import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {configuration} from '../src/config.mjs';
const now=Date.now(),key=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
const env={PUBLIC_DEPLOYMENT_ID:'wujie-v10-device-fixture',PUBLIC_BUNDLE_ID:'cn.qkxy.wujieai.public',APPLE_TEAM_ID:'5YR3BKMQ62',BILLING_ENVIRONMENT:'Sandbox',PUBLIC_RELEASE_PURPOSE:'A13_QA',
 APPLE_PRIVATE_KEY_PEM:key(),APPLE_KEY_ID:'identity',V10_IAP_PRIVATE_KEY_PEM:key(),V10_IAP_KEY_ID:'iap',V10_IAP_ISSUER_ID:'fixture-issuer',V10_LICENSE_SIGNING_KEY_PEM:key(),V10_LICENSE_SIGNING_KEY_ID:'license',
 V10_SUBSCRIPTION_PRODUCT_ID:'fixture.monthly',APPLE_IAP_ROOT_CERT_SHA256:'a'.repeat(64),DEVICE_APP_ATTEST_APP_ID:'5YR3BKMQ62.cn.qkxy.wujieai.public',DEVICE_APP_ATTEST_ENVIRONMENT:'development',
 V10_DEVICE_LICENSE_ENABLED:'true',V10_SERVICE_WINDOW_STARTS_AT:new Date(now-1000).toISOString(),V10_SERVICE_WINDOW_ENDS_AT:new Date(now+600000).toISOString()};
it('admits only complete, separate signer and device registration configurations within the absolute QA window',()=>{
 expect(configuration(env,now).admissionOpen).toBe(true);
 for(const patch of [{V10_LICENSE_SIGNING_KEY_PEM:''},{V10_IAP_PRIVATE_KEY_PEM:env.APPLE_PRIVATE_KEY_PEM},{DEVICE_APP_ATTEST_APP_ID:'other.bundle'},{APPLE_IAP_ROOT_CERT_SHA256:''},{V10_SUBSCRIPTION_PRODUCT_ID:''},{V10_DEVICE_LICENSE_ENABLED:'false'}])expect(configuration({...env,...patch},now).admissionOpen).toBe(false);
 expect(configuration(env,now+600000).admissionOpen).toBe(false);
});
it('QA cannot use matching source hashes to silently replace a missing bounded window',()=>{
 const e={...env,V10_SERVICE_WINDOW_STARTS_AT:undefined,V10_SERVICE_WINDOW_ENDS_AT:undefined,V10_SOURCE_MANIFEST_SHA256:'a'.repeat(64),V10_RELEASE_APPROVED_SOURCE_SHA256:'a'.repeat(64)};
 expect(configuration(e,now).admissionOpen).toBe(false);
});
