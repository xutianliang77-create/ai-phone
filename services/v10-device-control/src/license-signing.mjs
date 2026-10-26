import {createPrivateKey,sign} from 'node:crypto';
import {fail,canonical} from './common.mjs';
export const LICENSE_TYPE='wujie-v10-device-license+jwt';
export function signLicense(claims,keyId,pem){
 if(typeof keyId!=='string'||!keyId||typeof pem!=='string')fail('v10_license_signer_not_ready',503);
 let key;try{key=createPrivateKey(pem);}catch{fail('v10_license_signer_not_ready',503);}
 if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')fail('v10_license_signer_not_ready',503);
 const h=Buffer.from(JSON.stringify({alg:'ES256',typ:LICENSE_TYPE,kid:keyId})).toString('base64url'),b=Buffer.from(canonical(claims)).toString('base64url');
 return h+'.'+b+'.'+sign('sha256',Buffer.from(h+'.'+b),{key:pem,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
