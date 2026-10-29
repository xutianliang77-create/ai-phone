import {afterEach,expect,it} from 'vitest';
import {setup,now} from './control-fixture.js';
import {AppleAccountService,D1AccountLifecycleRepository} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {registerDeletionRecovery,recoverDeletionOwner} from '../src/deletion-recovery.mjs';
import {finalizeDeletion} from '../src/deletion-finalization.mjs';
import {deletionAcknowledgement,deletionStatus} from '../src/account.mjs';
import {hash} from '../src/common.mjs';

let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
function context(revoke=async()=>{}){
 const store=ctx.f.store(),lifecycle=new D1AccountLifecycleRepository(store),scope='fixture',clientId='fixture';
 const account=new AppleAccountService({scope},{scope},lifecycle,{scope,clientId},{clientId,revoke},
  {open:()=> 'synthetic-token'},{privacyVersion:'v1',termsVersion:'v1',tokenKeyId:'fixture',tokenKeys:new Map([['fixture',Buffer.alloc(32)]])});
 return {store,lifecycle,account};
}
async function requested(withCredential=true,secret?:string){
 const user=await ctx.owner('old');
 if(withCredential)ctx.f.db.prepare('INSERT INTO apple_credentials(identity_key,user_id,sealed_json,version,validated_ms) VALUES(?,?,?,?,?)').run('identity-old','old','{}',1,now);
 const c=context();await registerDeletionRecovery(c,user.actor,now,secret?hash('v10-deletion:'+secret):undefined);
 await c.lifecycle.requestDeletion({user_id:'old',authorization_epoch:1},now);
 const state=await recoverDeletionOwner(context(),'old',now);
 return {user,state};
}
it('anonymizes only the requested account after confirmed revocation and retains a bounded status receipt and billing chain',async()=>{
 ctx=setup();const other=ctx.f.seedUser('other'),{user,state}=await requested();
 expect(state.status).toBe('needs_finalization');
 const result=await finalizeDeletion(context(),'old',now+1);
 expect(result).toEqual({status:'completed',appleRevocation:'confirmed'});
 expect(ctx.f.db.prepare("SELECT count(*) n FROM accounts WHERE user_id='old'").get().n).toBe(0);
 expect(ctx.f.db.prepare("SELECT count(*) n FROM identities WHERE user_id='old'").get().n).toBe(0);
 expect(ctx.f.db.prepare("SELECT count(*) n FROM account_tokens WHERE user_id='old'").get().n).toBe(0);
 const receipt=ctx.f.db.prepare('SELECT * FROM v10_account_deletion_receipts WHERE token_hash=?').get(user.actor.tokenHash);
 expect(receipt.apple_revocation).toBe('confirmed');expect(receipt.expires_ms).toBeLessThanOrEqual(now+1+7*86400000);
 const chain=ctx.f.db.prepare('SELECT owner_id FROM v10_subscription_chains').get();
 expect(chain.owner_id).toBe(receipt.tombstone_id);expect(chain.owner_id).not.toBe('old');
 expect(ctx.count('v10_subscription_transactions')).toBe(1);
 expect(ctx.f.db.prepare("SELECT status FROM accounts WHERE user_id='other'").get().status).toBe('active');
 expect(other.id).toBe('other');
 const newUser=ctx.f.seedUser('old');
 expect(newUser.appAccountToken).not.toBe(user.user.appAccountToken);
 const actor={id:'old',tokenHash:newUser.tokenHash,authorizationEpoch:1};
 const evidence={transaction:user.transaction,renewal:{signedDate:now+2,autoRenewStatus:1},status:1,verifiedAtMs:now+2};
 expect((await ctx.subscriptions().restoreAfterDeletion(actor,user.transaction,evidence,'a'.repeat(64),now+2)).valid).toBe(true);
 expect(ctx.count('v10_subscription_transactions')).toBe(1);
});
it('does not finalize until all old offline permits have expired or reported close',async()=>{
 ctx=setup();const user=await ctx.owner('old');const license=await ctx.licenses().issue(user.actor,user.envelope(),now);
 ctx.f.db.prepare('INSERT INTO apple_credentials(identity_key,user_id,sealed_json,version,validated_ms) VALUES(?,?,?,?,?)').run('identity-old','old','{}',1,now);
 const c=context();await registerDeletionRecovery(c,user.actor,now);await c.lifecycle.requestDeletion({user_id:'old',authorization_epoch:1},now);
 await recoverDeletionOwner(context(),'old',now);
 expect((await finalizeDeletion(context(),'old',now+1)).status).toBe('waiting_for_offline_expiry');
 expect(ctx.f.db.prepare("SELECT status FROM accounts WHERE user_id='old'").get().status).toBe('deletion_requested');
 expect((await finalizeDeletion(context(),'old',license.expiresAtMs+1)).status).toBe('completed');
});
it('keeps legacy outbox and wallet data untouched and reports the concrete block',async()=>{
 ctx=setup();await requested();
 ctx.f.db.prepare("INSERT INTO finance_outbox(event_id,owner_id,event_type,aggregate_id,payload_json,state,due_ms) VALUES('legacy:event','old','apple.revoke','legacy','{}','pending',?)").run(now);
 expect((await finalizeDeletion(context(),'old',now+1)).status).toBe('legacy_data_requires_review');
 expect(ctx.f.db.prepare("SELECT state FROM finance_outbox WHERE event_id='legacy:event'").get().state).toBe('pending');
 expect(ctx.f.db.prepare("SELECT status FROM accounts WHERE user_id='old'").get().status).toBe('deletion_requested');
});
it('deletes local account identity even if no Apple token exists and reports manual revocation',async()=>{
 ctx=setup();const {state}=await requested(false);
 expect(state.status).toBe('manual_apple_required');
 expect(await finalizeDeletion(context(),'old',now+1)).toEqual({status:'completed',appleRevocation:'manual_required'});
 expect(ctx.f.db.prepare('SELECT apple_revocation FROM v10_account_deletion_receipts').get().apple_revocation).toBe('manual_required');
});
it('a scoped, expiring capability reports progress and completion without exposing account or subscription data',async()=>{
 ctx=setup();const secret='A'.repeat(43),{user}=await requested(true,secret);
 expect(await deletionStatus(context(),`DeletionReceipt ${secret}`,now)).toEqual({status:'processing'});
 await expect(deletionStatus(context(),'Bearer '+user.user.token,now)).rejects.toThrow('v10_deletion_status_not_found');
 await finalizeDeletion(context(),'old',now+1);
 expect(await deletionStatus(context(),`DeletionReceipt ${secret}`,now+2))
  .toEqual({status:'completed',appleRevocation:'confirmed',completedAtMs:now+1});
 expect((await deletionAcknowledgement(context(),'Bearer '+user.user.token,now+2))?.deletion.status).toBe('completed');
 await expect(deletionStatus(context(),`DeletionReceipt ${secret}`,now+7*86400000)).rejects.toThrow('v10_deletion_status_not_found');
});
it('a capability registered before a failed deletion does not report that deletion was submitted',async()=>{
 ctx=setup();const user=await ctx.owner('old'),secret='B'.repeat(43),c=context();
 await registerDeletionRecovery(c,user.actor,now,hash('v10-deletion:'+secret));
 expect(await deletionStatus(context(),`DeletionReceipt ${secret}`,now)).toEqual({status:'not_submitted'});
 expect(ctx.f.db.prepare("SELECT status FROM accounts WHERE user_id='old'").get().status).toBe('active');
});
it('a newly registered account with the same Apple identity can be deleted again without replaying the old completion',async()=>{
 ctx=setup();const {user}=await requested();
 await finalizeDeletion(context(),'old',now+1);
 const newUser=ctx.f.seedUser('old','synthetic-old-again'),actor={id:'old',tokenHash:newUser.tokenHash,authorizationEpoch:1};
 const at=now;
 ctx.f.db.prepare('INSERT INTO apple_credentials(identity_key,user_id,sealed_json,version,validated_ms) VALUES(?,?,?,?,?)').run('identity-old','old','{}',1,at);
 const c=context();await registerDeletionRecovery(c,actor,at);await c.lifecycle.requestDeletion({user_id:'old',authorization_epoch:1},at);
 expect((await recoverDeletionOwner(context(),'old',at)).status).toBe('needs_finalization');
 expect((await finalizeDeletion(context(),'old',at+1)).status).toBe('completed');
 expect(ctx.f.db.prepare("SELECT count(*) n FROM accounts WHERE user_id='old'").get().n).toBe(0);
 expect(ctx.f.db.prepare('SELECT count(*) n FROM v10_account_deletion_receipts').get().n).toBe(2);
 expect(user.user.appAccountToken).not.toBe(newUser.appAccountToken);
});
