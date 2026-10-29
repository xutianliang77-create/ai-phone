import {afterEach,expect,it} from 'vitest';
import {sign} from 'node:crypto';
import {setup,now} from './control-fixture.js';
import {BillingService} from '../src/billing-service.mjs';
import {PURCHASE_DOMAIN} from '../src/common.mjs';

let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
const evidence=(t:any,at=now)=>({transaction:t,renewal:{signedDate:at,autoRenewStatus:1},status:1,verifiedAtMs:at});
function newActor(id:string){const user=ctx.f.seedUser(id);return {id,tokenHash:user.tokenHash,authorizationEpoch:1};}
function deleteOld(id:string){ctx.f.db.prepare("UPDATE accounts SET status='deleted' WHERE user_id=?").run(id);}
function proof(user:any,options:{current?:boolean,restore?:boolean,target?:string}={}){
 const body={domain:PURCHASE_DOMAIN,ownerId:user.actor.id,deploymentId:ctx.config.deploymentId,
  devicePublicKey:user.raw.toString('base64'),requestKey:'c'.repeat(64),issuedAtMs:now,signedTransactionInfo:'synthetic-jws',
  storeKitCurrentEntitlement:options.current??true,...options.restore?{userInitiatedRestore:true,targetAccountToken:options.target??user.user.appAccountToken}:{}};
 const bytes=Buffer.from(JSON.stringify(body));
 return {clientData:bytes.toString('base64'),deviceSignature:sign('sha256',bytes,{key:user.device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};
}

it('never transfers an active or merely deletion-requested account',async()=>{
 ctx=setup();const old=await ctx.owner('old'),newOwner=newActor('new');
 await expect(ctx.subscriptions().restoreAfterDeletion(newOwner,old.transaction,evidence(old.transaction),'a'.repeat(64),now)).rejects.toThrow('v10_restore_previous_account_not_deleted');
 ctx.f.db.prepare("UPDATE accounts SET status='deletion_requested' WHERE user_id='old'").run();
 await expect(ctx.subscriptions().restoreAfterDeletion(newOwner,old.transaction,evidence(old.transaction),'a'.repeat(64),now)).rejects.toThrow('v10_restore_previous_account_not_deleted');
});

it('moves only a fresh verified active chain after deletion, preserves one period and permits renewal with the original Apple token',async()=>{
 ctx=setup();const old=await ctx.owner('old'),newOwner=newActor('new');deleteOld('old');
 const repo=ctx.subscriptions();
 expect((await repo.restoreAfterDeletion(newOwner,old.transaction,evidence(old.transaction),'a'.repeat(64),now)).valid).toBe(true);
 expect((await repo.entitlement('old',now)).valid).toBe(false);
 expect(ctx.count('v10_subscription_transactions')).toBe(1);
 expect(ctx.count('v10_subscription_restore_events')).toBe(1);
 expect(ctx.count('credit_lots')).toBe(0);
 await repo.sync(newOwner,old.transaction,{storeKitCurrentEntitlement:true},now+1);
 expect(ctx.count('v10_subscription_transactions')).toBe(1);
 expect(ctx.count('v10_subscription_restore_events')).toBe(1);
});

it('does not transfer while an old offline license may still be usable',async()=>{
 ctx=setup();const old=await ctx.owner('old'),newOwner=newActor('new');
 const license=await ctx.licenses().issue(old.actor,old.envelope(),now);deleteOld('old');
 await expect(ctx.subscriptions().restoreAfterDeletion(newOwner,old.transaction,evidence(old.transaction),'a'.repeat(64),now+1)).rejects.toThrow();
 expect(ctx.f.db.prepare('SELECT owner_id FROM v10_subscription_chains').get().owner_id).toBe('old');
 const at=license.expiresAtMs+1;
 expect((await ctx.subscriptions().restoreAfterDeletion(newOwner,old.transaction,evidence(old.transaction,at),'a'.repeat(64),at)).valid).toBe(true);
});

it('rejects revoked, stale, invalid or superseded Apple evidence',async()=>{
 ctx=setup();const old=await ctx.owner('old'),newOwner=newActor('new');deleteOld('old');const repo=ctx.subscriptions();
 await expect(repo.restoreAfterDeletion(newOwner,old.transaction,{...evidence(old.transaction),verifiedAtMs:now-60000},'a'.repeat(64),now)).rejects.toThrow('v10_restore_evidence_invalid');
 await expect(repo.restoreAfterDeletion(newOwner,{...old.transaction,revokedAtMs:now},evidence(old.transaction),'b'.repeat(64),now)).rejects.toThrow('v10_restore_evidence_invalid');
 await expect(repo.restoreAfterDeletion(newOwner,old.transaction,{...evidence(old.transaction),status:3},'c'.repeat(64),now)).rejects.toThrow('v10_restore_evidence_invalid');
 ctx.f.db.prepare('UPDATE v10_subscription_transactions SET revoked_ms=?,signed_ms=?').run(now,now+1);
 await expect(repo.restoreAfterDeletion(newOwner,old.transaction,evidence(old.transaction),'d'.repeat(64),now)).rejects.toThrow();
 expect(ctx.f.db.prepare('SELECT owner_id FROM v10_subscription_chains').get().owner_id).toBe('old');
});

it('only one competing new account can claim the chain',async()=>{
 ctx=setup();const old=await ctx.owner('old'),alice=newActor('alice'),bob=newActor('bob');deleteOld('old');
 const results=await Promise.allSettled([
  ctx.subscriptions().restoreAfterDeletion(alice,old.transaction,evidence(old.transaction),'a'.repeat(64),now),
  ctx.subscriptions().restoreAfterDeletion(bob,old.transaction,evidence(old.transaction),'b'.repeat(64),now),
 ]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(ctx.count('v10_subscription_restore_events')).toBe(1);
});

it('cross-account restore requires an explicit native current-entitlement proof before asking Apple',async()=>{
 ctx=setup();const old=await ctx.owner('old'),customer=await ctx.owner('customer');deleteOld('old');let checks=0;
 const verifier={transaction:async()=>old.transaction};
 const billing=new BillingService(ctx.f.store(),ctx.config,ctx.subscriptions(),verifier,{statusFactory:()=>({activeRestoreEvidence:async()=>{checks++;return evidence(old.transaction)}})});
 await expect(billing.sync(customer.actor,proof(customer),now)).rejects.toThrow('v10_restore_user_proof_required');
 await expect(billing.sync(customer.actor,proof(customer,{current:false,restore:true}),now)).rejects.toThrow('v10_restore_user_proof_required');
 await expect(billing.sync(customer.actor,proof(customer,{restore:true,target:old.user.appAccountToken}),now)).rejects.toThrow('v10_restore_account_generation_mismatch');
 expect(checks).toBe(0);
 const result=await billing.sync(customer.actor,proof(customer,{restore:true}),now);
 expect(result.ownershipTransferred).toBe(true);expect(result.restoreAcknowledged).toBe(true);expect(checks).toBe(1);
});
