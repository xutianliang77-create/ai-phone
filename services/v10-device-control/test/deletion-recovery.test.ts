import {expect,it} from 'vitest';
import {setup,now} from './control-fixture.js';
import {AppleAccountService,D1AccountLifecycleRepository} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {registerDeletionRecovery,recoverDeletionOwner,recoverDueDeletions} from '../src/deletion-recovery.mjs';

function fakeAccount(lifecycle:any,revoke:()=>Promise<void>){
 const scope='fixture',clientId='fixture';
 return new AppleAccountService({scope},{scope},lifecycle,{scope,clientId},
  {clientId,revoke}, {open:()=> 'synthetic-token'},
  {privacyVersion:'v1',termsVersion:'v1',tokenKeyId:'fixture',tokenKeys:new Map([['fixture',Buffer.alloc(32)]])});
}
async function requestWithCredential(f:any,owner:string,revoke:()=>Promise<void>){
 const user=f.seedUser(owner),store=f.store(),lifecycle=new D1AccountLifecycleRepository(store);
 f.db.prepare('INSERT INTO apple_credentials(identity_key,user_id,sealed_json,version,validated_ms) VALUES(?,?,?,?,?)')
  .run(`identity-${owner}`,owner,'{}',1,now);
 const ctx={store,account:fakeAccount(lifecycle,revoke)};
 await registerDeletionRecovery(ctx,{id:owner,authorizationEpoch:1,tokenHash:user.tokenHash},now);
 await lifecycle.requestDeletion({user_id:owner,authorization_epoch:1},now);
 const fresh=()=>{const s=f.store();return {store:s,account:fakeAccount(new D1AccountLifecycleRepository(s),revoke)};};
 return {ctx,lifecycle,user,fresh};
}

it('retries only the new owner deletion and preserves unrelated historical events',async()=>{
 const {f}=setup();let calls=0;
 try{
  const {fresh}=await requestWithCredential(f,'delete-user',async()=>{calls++;if(calls===1)throw Error('fixture network');});
  f.db.prepare("INSERT INTO finance_outbox(event_id,owner_id,event_type,aggregate_id,payload_json,state,due_ms) VALUES(?,?,?,?,?,'pending',?)")
   .run('historical:unrelated','delete-user','apple.revoke','unrelated','{}',now);
  expect((await recoverDeletionOwner(fresh(),'delete-user',now)).status).toBe('pending');
  expect((await recoverDeletionOwner(fresh(),'delete-user',now+1)).status).toBe('not_due');
  expect((await recoverDueDeletions(fresh(),now+30001)).map(x=>x.status)).toEqual(['needs_finalization']);
  expect(calls).toBe(2);
  expect(f.db.prepare("SELECT state FROM finance_outbox WHERE event_id='historical:unrelated'").get().state).toBe('pending');
  expect(f.db.prepare('SELECT status FROM accounts WHERE user_id=?').get('delete-user').status).toBe('deletion_requested');
  expect(f.db.prepare('SELECT COUNT(*) n FROM apple_credentials WHERE user_id=?').get('delete-user').n).toBe(0);
 }finally{f.close();}
});

it('does not process jobs for active accounts and never reports deletion complete without an Apple receipt',async()=>{
 const {f}=setup();
 try{
  const user=f.seedUser('active'),store=f.store(),lifecycle=new D1AccountLifecycleRepository(store);
  const ctx={store,account:fakeAccount(lifecycle,async()=>{})};
  await registerDeletionRecovery(ctx,{id:'active',authorizationEpoch:1,tokenHash:user.tokenHash},now);
  expect(await recoverDueDeletions(ctx,now)).toEqual([]);
  await lifecycle.requestDeletion({user_id:'active',authorization_epoch:1},now);
  expect((await recoverDeletionOwner(ctx,'active',now)).status).toBe('manual_apple_required');
  expect(f.db.prepare('SELECT status FROM accounts WHERE user_id=?').get('active').status).toBe('deletion_requested');
 }finally{f.close();}
});

it('claims one attempt under concurrent recovery and does not repeat Apple calls',async()=>{
 const {f}=setup();let calls=0,resolve!:()=>void;
 try{
  const gate=new Promise<void>(r=>resolve=r);
  const {fresh}=await requestWithCredential(f,'racing',async()=>{calls++;await gate;});
  const first=recoverDeletionOwner(fresh(),'racing',now);
  while(calls===0)await new Promise(r=>setTimeout(r,0));
  const second=await recoverDeletionOwner(fresh(),'racing',now);
  expect(second.status).toBe('not_due');
  resolve();expect((await first).status).toBe('needs_finalization');
  expect(calls).toBe(1);
 }finally{f.close();}
});

it('a crashed final attempt is held for reconciliation, not retried indefinitely',async()=>{
 const {f}=setup();let calls=0;
 try{
  const {fresh}=await requestWithCredential(f,'crashed',async()=>{calls++;});
  f.db.prepare("UPDATE v10_account_deletion_recovery SET attempts=8,lease_id='old',lease_until_ms=? WHERE owner_id='crashed'").run(now-1);
  expect((await recoverDeletionOwner(fresh(),'crashed',now)).status).toBe('reconcile_required');
  expect(calls).toBe(0);
  expect(f.db.prepare("SELECT state FROM finance_outbox WHERE owner_id='crashed' AND event_type='apple.revoke'").get().state).toBe('pending');
 }finally{f.close();}
});
