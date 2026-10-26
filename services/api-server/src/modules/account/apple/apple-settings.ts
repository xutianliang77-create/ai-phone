import {createPrivateKey} from "node:crypto";
import {isPublicReleaseEndpoint} from "@translation/platform-security";
import {AppleIdentityError} from './apple-identity.js';
export interface AppleSettings {deploymentId:string;origin:string;clientId:string;teamId:string;keyId:string;privateKeyPem:string;
 tokenSecret:string;credentialKey:Uint8Array;privacyVersion:string;termsVersion:string;}
export function appleEnabled(){return process.env.AUTH_PROVIDER==='apple';}
export function readAppleSettings():AppleSettings{
 const e=process.env,origin=e.API_PUBLIC_ORIGIN??'';
 if(!appleEnabled())throw new AppleIdentityError('apple_signin_not_enabled');
 let u:URL;try{u=new URL(origin);}catch{throw new AppleIdentityError('apple_origin_not_configured');}
 const loopback=process.env.NODE_ENV==='test'&&['127.0.0.1','localhost'].includes(u.hostname);
 if((!isPublicReleaseEndpoint(origin,['https:'])&&!loopback)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new AppleIdentityError('apple_origin_not_configured');
 const required=['ACCOUNT_DEPLOYMENT_ID','APPLE_CLIENT_ID','APPLE_TEAM_ID','APPLE_KEY_ID','APPLE_PRIVATE_KEY_PEM','APPLE_ACCOUNT_TOKEN_SECRET','APPLE_CREDENTIAL_ENCRYPTION_KEY','PRIVACY_POLICY_VERSION','TERMS_VERSION'] as const;
 if(required.some(k=>!e[k]?.trim()||/replace-with|changeme|UNBOUND/i.test(e[k]!)))throw new AppleIdentityError('apple_configuration_required');
 try{const key=createPrivateKey(e.APPLE_PRIVATE_KEY_PEM!);if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error();}catch{throw new AppleIdentityError('apple_private_key_invalid');}
 if(e.APPLE_ACCOUNT_TOKEN_SECRET!.length<32||!/^[a-f0-9]{64}$/i.test(e.APPLE_CREDENTIAL_ENCRYPTION_KEY!))throw new AppleIdentityError('apple_signing_configuration_required');
 return {deploymentId:e.ACCOUNT_DEPLOYMENT_ID!,origin:u.origin,clientId:e.APPLE_CLIENT_ID!,teamId:e.APPLE_TEAM_ID!,keyId:e.APPLE_KEY_ID!,privateKeyPem:e.APPLE_PRIVATE_KEY_PEM!,
 tokenSecret:e.APPLE_ACCOUNT_TOKEN_SECRET!,credentialKey:Buffer.from(e.APPLE_CREDENTIAL_ENCRYPTION_KEY!,'hex'),privacyVersion:e.PRIVACY_POLICY_VERSION!,termsVersion:e.TERMS_VERSION!};
}
export function appleReadiness(){try{readAppleSettings();return {status:'ready' as const,provider:'apple' as const,issues:[] as string[]};}catch(error){return {status:'not_ready' as const,provider:'apple' as const,issues:[error instanceof AppleIdentityError?error.code:'apple_configuration_required']};}}
