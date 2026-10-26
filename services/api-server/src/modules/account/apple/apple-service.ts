import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {AppleIdentityError,AppleIdentityVerifier,sha256,sameSecret} from './apple-identity.js';
import {AppleCredentialVault} from './credential-vault.js';
import {AppleOAuthClient,appleClientSecret} from './apple-oauth.js';
import {mutateAppleState,readAppleState,appleAccount,type AppleChallenge,type AppleSession} from './apple-state.js';
import {readAppleSettings,type AppleSettings} from './apple-settings.js';
import {toAccountDto} from '../account.service.js';
import {getStoreSnapshot} from '../../../infrastructure/storage/json-store.js';
import {getRepositoryRuntime} from '../../../infrastructure/storage/repository-runtime.js';
import type {AccountRecord} from '../account-record.js';

export interface AppleLoginInput {deploymentId:string;challengeId:string;state:string;bindingSecret:string;identityToken:string;authorizationCode:string;
 agreements:{privacyAccepted:boolean;termsAccepted:boolean;privacyVersion:string;termsVersion:string};}
export const appleTokenHash=(token:string)=>sha256('auth-token:'+token);
export class SelfHostedAppleService {
 readonly verifier:AppleIdentityVerifier;readonly oauth:AppleOAuthClient;readonly vault:AppleCredentialVault;readonly scope:string;
 constructor(readonly settings:AppleSettings,ports?:{verifier?:AppleIdentityVerifier;oauth?:AppleOAuthClient}){
  this.verifier=ports?.verifier??new AppleIdentityVerifier(settings.clientId,settings.teamId);
  this.oauth=ports?.oauth??new AppleOAuthClient(settings.clientId,async()=>appleClientSecret(settings,Date.now()));
  this.scope=settings.deploymentId+':'+this.verifier.scope;
  this.vault=new AppleCredentialVault(new Map([['v1',settings.credentialKey]]),'v1',this.scope);
 }
 async begin(client:string,now=Date.now()){
  const id=randomUUID(),state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url'),nonce=sha256(randomBytes(32).toString('base64url'));
  await mutateAppleState(this.scope,undefined,s=>{
   for(const [id,c]of Object.entries(s.challenges))if(c.expiresMs<now-7*86400000)delete s.challenges[id];
   if(Object.values(s.challenges).filter(c=>c.clientHash===sha256(client)&&c.createdMs>now-600000).length>=10)throw new AppleIdentityError('apple_challenge_rate_limited');
   if(Object.keys(s.challenges).length>=20000)throw new AppleIdentityError('apple_challenge_capacity');
   s.challenges[id]={id,nonce,stateHash:sha256(state),bindingHash:sha256(binding),createdMs:now,expiresMs:now+300000,clientHash:sha256(client),phase:'new'};
   return {result:null};
  });
  return {deploymentId:this.settings.deploymentId,challengeId:id,nonce,state,bindingSecret:binding,expiresAt:new Date(now+300000).toISOString(),
   privacyVersion:this.settings.privacyVersion,termsVersion:this.settings.termsVersion};
 }
 async login(input:AppleLoginInput,now=Date.now()){
  this.validate(input);let state=await readAppleState(this.scope),challenge=state.challenges[input.challengeId];this.check(challenge,input,now);
  const requestHash=sha256(JSON.stringify([input.authorizationCode,input.identityToken,input.agreements]));
  if(challenge.requestHash&&challenge.requestHash!==requestHash)throw new AppleIdentityError('apple_signin_conflict');
  if(challenge.phase==='consumed')return this.replay(challenge,input,now);
  if(challenge.phase==='prepared'||challenge.phase==='unknown')throw new AppleIdentityError('apple_exchange_requires_fresh_signin');
  const identity=await this.verifier.verifyToken(input.identityToken,challenge.nonce,now),ownerId='usr_'+sha256(this.scope+':'+identity.identityKey).slice(0,32);
  if(challenge.phase==='new'){
   await mutateAppleState(this.scope,ownerId,(s,account)=>{
    const c=s.challenges[input.challengeId];this.check(c,input,now);
    if(c.phase!=='new')throw new AppleIdentityError('apple_exchange_requires_fresh_signin');
    if(account&&account.status!=='active')throw new AppleIdentityError('account_unavailable');
    c.phase='prepared';c.requestHash=requestHash;c.ownerId=ownerId;c.identityKey=identity.identityKey;return {result:null};
   });
   try{
    const response=await this.oauth.exchange(input.authorizationCode),verified=await this.verifier.verifyToken(response.idToken,challenge.nonce,now);
    if(verified.identityKey!==identity.identityKey||!response.refreshToken)throw new AppleIdentityError('apple_exchange_identity_mismatch');
    const sealed=this.vault.seal(identity.identityKey,ownerId,response.refreshToken);
    await mutateAppleState(this.scope,ownerId,(s,account)=>{
     const c=s.challenges[input.challengeId];if(c.phase!=='prepared'||c.requestHash!==requestHash)throw new AppleIdentityError('apple_signin_conflict');
     if(account&&account.status!=='active')throw new AppleIdentityError('account_unavailable');
     c.phase='completed';c.sealed=sealed;return {result:null};
    });
   }catch(error){
    await mutateAppleState(this.scope,ownerId,s=>{const c=s.challenges[input.challengeId];if(c.phase==='prepared')c.phase='unknown';return {result:null};}).catch(()=>undefined);
    throw error instanceof AppleIdentityError?error:new AppleIdentityError('apple_signin_unconfirmed');
   }
  }
  const token=this.bearer(challenge.id,ownerId,input.bindingSecret),hash=appleTokenHash(token);
  await mutateAppleState(this.scope,ownerId,(s,existing)=>{
   const c=s.challenges[input.challengeId];this.check(c,input,now);
   if(c.phase==='consumed')return {result:{replayed:true,account:existing!}};
   if(c.phase!=='completed'||c.requestHash!==requestHash||!c.sealed||c.identityKey!==identity.identityKey||c.ownerId!==ownerId)throw new AppleIdentityError('apple_login_unconfirmed');
   if(existing&&existing.status!=='active')throw new AppleIdentityError('account_unavailable');
   const iso=new Date(now).toISOString(),account:AccountRecord={...existing,id:ownerId,phoneHash:'apple:'+identity.identityKey,phoneMasked:'',status:'active',
    createdAt:existing?.createdAt??iso,updatedAt:iso,lastLoginAt:iso};
   c.phase='consumed';c.tokenHash=hash;
   s.credentials[identity.identityKey]={identityKey:identity.identityKey,ownerId,sealed:c.sealed,validatedMs:now};
   s.tokenBindings[hash]={ownerId,identityKey:identity.identityKey};
   const session={tokenHash:hash,userId:ownerId,createdAt:iso,expiresAt:new Date(now+30*86400000).toISOString()};
   return {result:{replayed:false,account},account,session,consents:[{id:'consent_apple_'+c.id,userId:ownerId,consentType:'initial_privacy',
    version:input.agreements.privacyVersion+'|'+input.agreements.termsVersion,scene:'app_start',acceptedAt:iso,recordedAt:iso,source:'apple_login'}]};
  });
  return this.replay((await readAppleState(this.scope)).challenges[input.challengeId],input,now);
 }
 async authorizeHash(hash:string,now=Date.now()):Promise<AccountRecord|null>{
  const state=await readAppleState(this.scope),binding=state.tokenBindings[hash];if(!binding)return null;
  let credential=state.credentials[binding.identityKey];const session=await this.session(hash);
  const account=await appleAccount(binding.ownerId);
  if(!session||session.revokedAt||Date.parse(session.expiresAt)<=now||account?.status!=='active'||!credential||credential.revokedMs||credential.deletionRequestedMs)return null;
  if(credential.refreshUnknown)throw new AppleIdentityError('apple_refresh_requires_fresh_signin');
  if(now-credential.validatedMs>=86400000){
   await mutateAppleState(this.scope,account.id,(s,a)=>{const c=s.credentials[binding.identityKey];
    if(a?.status!=='active'||c.revokedMs||c.refreshClaimedMs&&now-c.refreshClaimedMs<30000)throw new AppleIdentityError('apple_refresh_pending');
    c.refreshClaimedMs=now;return {result:null};});
   try{
    const previous=this.vault.open(credential.identityKey,account.id,credential.sealed),response=await this.oauth.refresh(previous);
    const identity=await this.verifier.verifyToken(response.idToken,null,now);
    if(identity.identityKey!==credential.identityKey)throw new AppleIdentityError('apple_refresh_identity_mismatch');
    const sealed=this.vault.seal(credential.identityKey,account.id,response.refreshToken??previous);
    await mutateAppleState(this.scope,account.id,(s,a)=>{const c=s.credentials[binding.identityKey];
     if(a?.status!=='active'||c.revokedMs||c.deletionRequestedMs)throw new AppleIdentityError('account_unavailable');
     c.sealed=sealed;c.validatedMs=now;c.refreshClaimedMs=undefined;return {result:null};});
   }catch(error){
    if(error instanceof AppleIdentityError&&error.code==='apple_credential_revoked'){
     await mutateAppleState(this.scope,account.id,s=>{s.credentials[binding.identityKey].revokedMs=now;return {result:null,revokeUser:account.id};});return null;
    }
    await mutateAppleState(this.scope,account.id,s=>{s.credentials[binding.identityKey].refreshUnknown=true;return {result:null};});
    throw error instanceof AppleIdentityError?error:new AppleIdentityError('apple_refresh_pending');
   }
  }
  return (await appleAccount(account.id))?.status==='active'?account:null;
 }
 async requestDeletion(hash:string,now=Date.now()){
  const account=await this.authorizeHash(hash,now);if(!account)throw new AppleIdentityError('auth_required');
  await mutateAppleState(this.scope,account.id,(s,a)=>{
   if(a?.status!=='active')throw new AppleIdentityError('account_unavailable');
   for(const c of Object.values(s.credentials))if(c.ownerId===a.id){c.deletionRequestedMs=now;c.revocationStatus='pending';}
   return {result:null,account:{...a,status:'deletion_requested',deletionRequestedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()},revokeUser:a.id};
  });
  const revocation=await this.processDeletion(account.id,now);
  return {account:toAccountDto((await appleAccount(account.id))!),revocationStatus:revocation};
 }
 /** Targeted only: no historical/global queue is started. */
 async processDeletion(ownerId:string,now=Date.now()){
  const state=await readAppleState(this.scope),pending=Object.values(state.credentials).filter(c=>c.ownerId===ownerId&&c.deletionRequestedMs&&c.revocationStatus==='pending');
  for(const c of pending){try{
   await this.oauth.revoke(this.vault.open(c.identityKey,ownerId,c.sealed));
   await mutateAppleState(this.scope,ownerId,s=>{const saved=s.credentials[c.identityKey];if(saved.deletionRequestedMs){saved.revocationStatus='confirmed';saved.revokedMs=now;}return {result:null};});
  }catch{return 'pending' as const;}}
  return 'confirmed' as const;
 }
 async hasHash(hash:string){return !!(await readAppleState(this.scope)).tokenBindings[hash];}
 private async session(hash:string):Promise<AppleSession|null>{
  const runtime=getRepositoryRuntime();if(runtime.driver==='postgres')return runtime.postgres.productRecords.findByLookup<AppleSession>('authSessions',hash);
  const s=getStoreSnapshot().authSessions.find(x=>x.token==='hash-v1:'+hash);return s?{...s,tokenHash:hash}:null;
 }
 private async replay(c:AppleChallenge,input:AppleLoginInput,now:number){
  const token=this.bearer(c.id,c.ownerId!,input.bindingSecret),hash=appleTokenHash(token),account=await this.authorizeHash(hash,now),session=await this.session(hash);
  if(!account||!session||c.tokenHash!==hash)throw new AppleIdentityError('apple_login_revoked');
  return {deploymentId:this.settings.deploymentId,token,expiresAt:session.expiresAt,account:toAccountDto(account)};
 }
 private bearer(id:string,owner:string,binding:string){return 'wj_'+createHmac('sha256',this.settings.tokenSecret).update(JSON.stringify({purpose:'wujie-v10-login-v1',scope:this.scope,id,owner,binding})).digest('base64url');}
 private check(c:AppleChallenge|undefined,i:AppleLoginInput,now:number):asserts c is AppleChallenge{
  if(!c||c.expiresMs<=now||!sameSecret(c.stateHash,sha256(i.state))||!sameSecret(c.bindingHash,sha256(i.bindingSecret)))throw new AppleIdentityError('apple_challenge_unavailable');
 }
 private validate(i:AppleLoginInput){
  if(!i||i.deploymentId!==this.settings.deploymentId||i.agreements?.privacyAccepted!==true||i.agreements?.termsAccepted!==true||
   i.agreements.privacyVersion!==this.settings.privacyVersion||i.agreements.termsVersion!==this.settings.termsVersion)throw new AppleIdentityError('account_agreements_required');
  for(const [v,n]of [[i.challengeId,160],[i.state,256],[i.bindingSecret,256],[i.identityToken,16384],[i.authorizationCode,2048]] as const)
   if(typeof v!=='string'||!v.length||Buffer.byteLength(v)>n)throw new AppleIdentityError('apple_invalid_input');
 }
}
let current:SelfHostedAppleService|undefined;
export function appleService(){return current??=new SelfHostedAppleService(readAppleSettings());}
export function resetAppleService(){current=undefined;}
