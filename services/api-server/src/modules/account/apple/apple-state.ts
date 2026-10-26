import {randomUUID} from 'node:crypto';
import {getStoreSnapshot,persistStoreSnapshot,runStoreTransaction} from '../../../infrastructure/storage/json-store.js';
import {getRepositoryRuntime} from '../../../infrastructure/storage/repository-runtime.js';
import {PostgresPrimaryStore} from '../../../infrastructure/storage/postgres-primary-store.js';
import {withPostgresRepositoryFence} from '../../../infrastructure/storage/postgres-repository-fence.js';
import type {AccountRecord,AccountConsentRecord} from '../account-record.js';
import type {SealedAppleCredential} from './credential-vault.js';

export interface AppleChallenge {
 id:string;nonce:string;stateHash:string;bindingHash:string;createdMs:number;expiresMs:number;clientHash:string;
 phase:'new'|'prepared'|'completed'|'unknown'|'consumed';requestHash?:string;ownerId?:string;identityKey?:string;
 sealed?:SealedAppleCredential;tokenHash?:string;
}
export interface AppleCredential {
 identityKey:string;ownerId:string;sealed:SealedAppleCredential;validatedMs:number;
 refreshClaimedMs?:number;refreshUnknown?:boolean;revokedMs?:number;deletionRequestedMs?:number;revocationStatus?:'pending'|'confirmed';
}
export interface AppleState {
 id:string;ownerId:string;version:number;challenges:Record<string,AppleChallenge>;
 credentials:Record<string,AppleCredential>;tokenBindings:Record<string,{ownerId:string;identityKey:string}>;
}
export interface AppleSession {tokenHash:string;userId:string;createdAt:string;expiresAt:string;revokedAt?:string;}
interface Effects<T> {result:T;account?:AccountRecord;session?:AppleSession;consents?:AccountConsentRecord[];revokeUser?:string;}
export const emptyAppleState=(scope:string):AppleState=>({id:scope,ownerId:'apple-control',version:0,challenges:{},credentials:{},tokenBindings:{}});
const storedHash=(value:string)=>value.startsWith('hash-v1:')?value.slice(8):undefined;

/** Metadata and the original account/session/consent records share one commit.
 * No wallet, grant, D1, external queue or model operation is performed here. */
export async function mutateAppleState<T>(scope:string,ownerId:string|undefined,change:(s:AppleState,a:AccountRecord|null)=>Effects<T>):Promise<T>{
 const runtime=getRepositoryRuntime();
 if(runtime.driver!=='postgres')return runStoreTransaction(()=>{
  const store=getStoreSnapshot(),state=structuredClone(store.appleAuthStates.find(x=>x.id===scope)??emptyAppleState(scope));
  const account=store.accounts.find(a=>a.id===ownerId)??null,result=change(state,account);
  state.version++;store.appleAuthStates=[...store.appleAuthStates.filter(x=>x.id!==scope),state];
  if(result.account)store.accounts=[...store.accounts.filter(a=>a.id!==result.account!.id),result.account];
  if(result.session){const v=result.session;store.authSessions=[...store.authSessions.filter(s=>storedHash(s.token)!==v.tokenHash),{token:'hash-v1:'+v.tokenHash,userId:v.userId,createdAt:v.createdAt,expiresAt:v.expiresAt,...(v.revokedAt?{revokedAt:v.revokedAt}:{})}];}
  if(result.consents)store.accountConsentRecords.push(...result.consents);
  if(result.revokeUser)for(const session of store.authSessions)if(session.userId===result.revokeUser&&!session.revokedAt)session.revokedAt=new Date().toISOString();
  persistStoreSnapshot();return result.result;
 });
 const primary=new PostgresPrimaryStore(runtime.postgres.pool);
 return withPostgresRepositoryFence({aggregateType:'apple_control',aggregateId:scope},fence=>primary.withAggregateTransaction(fence,async tx=>{
  const record=await tx.read<AppleState>('appleAuthStates',scope),state=structuredClone(record?.payload??emptyAppleState(scope));
  const accountRecord=ownerId?await tx.read<AccountRecord>('accounts',ownerId):null,account=accountRecord?.payload??null;
  const versions=new Map<string,number|null>([['appleAuthStates:'+scope,record?.recordVersion??null],...(ownerId?[['accounts:'+ownerId,accountRecord?.recordVersion??null] as [string,number|null]]:[])]);
  const result=change(state,account);state.version++;
  const save=async(namespace:string,key:string,payload:unknown)=>{const marker=namespace+':'+key;if(!versions.has(marker))versions.set(marker,(await tx.read(namespace,key))?.recordVersion??null);await tx.mutate({eventId:randomUUID(),namespace,recordKey:key,operation:'upsert',payload,expectedRecordVersion:versions.get(marker)??null});};
  await save('appleAuthStates',scope,state);
  if(result.account)await save('accounts',result.account.id,result.account);
  if(result.session)await save('authSessions',result.session.tokenHash,result.session);
  for(const consent of result.consents??[])await save('accountConsents',consent.id,consent);
  if(result.revokeUser)for(const [hash,binding]of Object.entries(state.tokenBindings)){
   if(binding.ownerId!==result.revokeUser)continue;
   const session=(await tx.read<AppleSession>('authSessions',hash))?.payload;
   if(session&&!session.revokedAt)await save('authSessions',hash,{...session,revokedAt:new Date().toISOString()});
  }
  return result.result;
 }));
}
export async function readAppleState(scope:string){
 const runtime=getRepositoryRuntime();return runtime.driver==='postgres'
 ?await runtime.postgres.productRecords.find<AppleState>('appleAuthStates',scope)??emptyAppleState(scope)
 :structuredClone(getStoreSnapshot().appleAuthStates.find(x=>x.id===scope)??emptyAppleState(scope));
}
export async function appleAccount(id:string){
 const runtime=getRepositoryRuntime();return runtime.driver==='postgres'?runtime.postgres.productRecords.find<AccountRecord>('accounts',id):getStoreSnapshot().accounts.find(a=>a.id===id)??null;
}
