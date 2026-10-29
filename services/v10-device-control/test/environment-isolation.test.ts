import {it,expect,afterEach} from 'vitest';
import {setup,now} from './control-fixture.js';
import {AppleSubscriptionStatus} from '../src/apple-subscription-status.mjs';
let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());

it('a fresh sandbox subscription never grants production entitlement',async()=>{
 ctx=setup();const u=await ctx.owner('alice');const chain=ctx.subscriptions().chainKey(u.transaction);
 ctx.f.db.prepare('INSERT INTO v10_subscription_status VALUES(?,?,?,?,?,?,?,?,?)').run(chain,'alice',now,now,1,0,0,null,'fixture');
 ctx.config['requireFreshStatus']=true;
 expect((await ctx.subscriptions().entitlement('alice',now+1)).valid).toBe(true);
 ctx.config.environment='Production';
 expect((await ctx.subscriptions().entitlement('alice',now+1)).valid).toBe(false);
});

it('a production entitlement refresh never reads a sandbox-only chain',async()=>{
 ctx=setup();await ctx.owner('alice');ctx.config.environment='Production';let outbound=0;
 const service=new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),{} as never,async()=>{outbound++;throw Error('unexpected_external_request');});
 await expect(service.refresh('alice',now+60001)).resolves.toBeUndefined();expect(outbound).toBe(0);
});

it('the customer ledger excludes transactions from the other environment',async()=>{
 ctx=setup();await ctx.owner('alice');expect((await ctx.subscriptions().ledger('alice')).ledger).toHaveLength(1);
 ctx.config.environment='Production';expect((await ctx.subscriptions().ledger('alice')).ledger).toHaveLength(0);
});

it('repository rejects transaction sync from the other environment',async()=>{
 ctx=setup();const u=await ctx.owner('alice');ctx.config.environment='Production';
 await expect(ctx.subscriptions().sync(u.actor,u.transaction,{},now+1)).rejects.toThrow('v10_subscription_environment_mismatch');
});

it('mixed-environment records stay isolated for the same owner and refund',async()=>{
 ctx=setup();const u=await ctx.owner('alice');const sandbox=u.transaction;
 ctx.config.environment='Production';
 const production={...sandbox,environment:'Production',transactionId:'prod-101',originalTransactionId:'prod-100',payloadHash:'c'.repeat(64)};
 await ctx.subscriptions().sync(u.actor,production,{},now+1);
 expect((await ctx.subscriptions().entitlement('alice',now+2)).valid).toBe(true);
 expect((await ctx.subscriptions().ledger('alice')).ledger).toHaveLength(1);
 ctx.config.environment='Sandbox';
 expect((await ctx.subscriptions().entitlement('alice',now+2)).valid).toBe(true);
 await ctx.subscriptions().sync(u.actor,{...sandbox,signedAtMs:now+10,revokedAtMs:now+10,payloadHash:'d'.repeat(64)}, {},now+10);
 expect((await ctx.subscriptions().entitlement('alice',now+11)).valid).toBe(false);
 ctx.config.environment='Production';
 expect((await ctx.subscriptions().entitlement('alice',now+11)).valid).toBe(true);
 expect((await ctx.subscriptions().ledger('alice')).ledger).toHaveLength(1);
});

it('production refresh uses only its production chain and endpoint',async()=>{
 ctx=setup();const u=await ctx.owner('alice');ctx.config.environment='Production';
 const production={...u.transaction,environment:'Production',transactionId:'201',originalTransactionId:'200',payloadHash:'e'.repeat(64)};
 await ctx.subscriptions().sync(u.actor,production,{},now+1);
 ctx.config['iapIssuerId']='fixture-issuer';ctx.config['iapKeyId']='fixture-key';ctx.config['iapPrivateKeyPem']=ctx.signer.privateKey.export({type:'pkcs8',format:'pem'}).toString();ctx.config['appAppleId']=42;
 const renewal={environment:'Production',productId:ctx.config.productId,originalTransactionId:'200',signedDate:now+2,autoRenewStatus:0};
 const verifier={transaction:async()=>production,renewal:async()=>renewal} as never;const urls:string[]=[];
 const transport=async(url:string)=>{urls.push(url);return Response.json({bundleId:ctx.config.bundleId,environment:'Production',appAppleId:42,data:[{lastTransactions:[{originalTransactionId:'200',status:1,signedTransactionInfo:'fixture',signedRenewalInfo:'fixture'}]}]});};
 await new AppleSubscriptionStatus(ctx.f.store(),ctx.config,ctx.subscriptions(),verifier,transport).refresh('alice',now+2);
 expect(urls).toEqual(['https://api.storekit.apple.com/inApps/v1/subscriptions/200']);
});

it('cross-environment restore evidence is rejected before transferring ownership',async()=>{
 ctx=setup();const u=await ctx.owner('alice');ctx.config.environment='Production';
 await expect(ctx.subscriptions().restoreAfterDeletion(u.actor,u.transaction,{transaction:u.transaction},'a'.repeat(64),now)).rejects.toThrow('v10_subscription_environment_mismatch');
 expect(ctx.count('v10_subscription_restore_events')).toBe(0);
});
