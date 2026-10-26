import {it,expect,afterEach} from 'vitest';
import {setup,now} from './control-fixture.js';
let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
it('transaction and out-of-order replay never add months or create a seconds wallet grant',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),t=u.transaction;
 await ctx.subscriptions().sync(u.actor,t,{},now+10);await ctx.subscriptions().sync(u.actor,t,{},now+20);
 expect(ctx.count('v10_subscription_transactions')).toBe(1);expect(ctx.count('v10_subscription_events')).toBe(1);expect(ctx.count('credit_lots')).toBe(0);
 expect((await ctx.subscriptions().entitlement(u.actor.id,now)).expiresAtMs).toBe(t.expiresAtMs);
});
it('refund revocation cannot be reversed by replaying older signed evidence',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),t=u.transaction;
 await ctx.subscriptions().sync(u.actor,{...t,signedAtMs:now+100,revokedAtMs:now+100,payloadHash:'b'.repeat(64)}, {},now+100);
 expect((await ctx.subscriptions().entitlement('alice',now+101)).valid).toBe(false);
 await ctx.subscriptions().sync(u.actor,t,{},now+200);expect((await ctx.subscriptions().entitlement('alice',now+201)).valid).toBe(false);
});
it('wrong account token or a claimed existing chain cannot steal subscription ownership',async()=>{
 ctx=setup();const a=await ctx.owner('alice'),b=await ctx.owner('bob');
 await expect(ctx.subscriptions().sync(b.actor,a.transaction,{},now)).rejects.toThrow('v10_subscription_owned_by_other_account');
 await expect(ctx.subscriptions().sync(a.actor,{...a.transaction,originalTransactionId:'new-chain',transactionId:'other',appAccountToken:b.user.appAccountToken}, {},now)).rejects.toThrow('v10_subscription_account_mismatch');
});
