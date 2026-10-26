import {beforeEach,describe,it,expect,vi} from 'vitest';
import {mutateAppleState,emptyAppleState} from './apple-state.js';
const db=vi.hoisted(()=>({records:new Map<string,{recordVersion:number;payload:Record<string,unknown>}>(),deleteDuringRead:false}));
vi.mock('../../../infrastructure/storage/repository-runtime.js',()=>({getRepositoryRuntime:()=>({driver:'postgres',postgres:{pool:{}}})}));
vi.mock('../../../infrastructure/storage/postgres-repository-fence.js',()=>({withPostgresRepositoryFence:async(_scope:unknown,fn:(f:unknown)=>unknown)=>fn({})}));
vi.mock('../../../infrastructure/storage/postgres-primary-store.js',()=>({PostgresPrimaryStore:class{
 async withAggregateTransaction(_f:unknown,run:(tx:unknown)=>Promise<unknown>){
  const staged=new Map<string,{recordVersion:number;payload:Record<string,unknown>}>();
  const tx={read:async(ns:string,key:string)=>{
   const id=ns+':'+key,value=structuredClone(staged.get(id)??db.records.get(id)??null);
   if(ns==='accounts'&&db.deleteDuringRead){db.deleteDuringRead=false;db.records.set(id,{recordVersion:2,payload:{...value!.payload,status:'deleted'}});}
   return value;
  },mutate:async(v:{namespace:string;recordKey:string;expectedRecordVersion:number|null;payload:Record<string,unknown>})=>{
   const id=v.namespace+':'+v.recordKey,current=staged.get(id)??db.records.get(id);
   if((current?.recordVersion??null)!==v.expectedRecordVersion)throw Error('Primary record version conflict');
   const next={recordVersion:(current?.recordVersion??0)+1,payload:v.payload};staged.set(id,next);return next;
  }};
  const result=await run(tx);for(const [key,value]of staged)db.records.set(key,value);return result;
 }
}}));
describe('Apple account metadata PostgreSQL CAS boundary, simulated primary transaction',()=>{
 beforeEach(()=>{db.records.clear();db.deleteDuringRead=false;db.records.set('accounts:owner',{recordVersion:1,payload:{id:'owner',phoneHash:'synthetic',phoneMasked:'',status:'active',createdAt:'old',updatedAt:'old'}});});
 it('cannot reactivate an account deleted concurrently after its original read',async()=>{
  db.deleteDuringRead=true;
  await expect(mutateAppleState('scope','owner',(s,a)=>{s.challenges={};return {result:'login',account:{...a!,updatedAt:'new'}};})).rejects.toThrow('version conflict');
  expect(db.records.get('accounts:owner')!.payload.status).toBe('deleted');expect(db.records.has('appleAuthStates:scope')).toBe(false);
 });
 it('commits metadata and canonical account effects together when the read version still matches',async()=>{
  await mutateAppleState('scope','owner',(s,a)=>({result:null,account:{...a!,updatedAt:'new'}}));
  expect(db.records.get('accounts:owner')!.payload.updatedAt).toBe('new');expect(db.records.get('appleAuthStates:scope')!.payload.version).toBe(1);
 });
});
