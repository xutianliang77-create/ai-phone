import {it,expect,afterEach} from 'vitest';
import {verify} from 'node:crypto';
import {setup,now} from './control-fixture.js';
let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
it('issues no more than 30min, survives zero seconds balance and does not create minute holds',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),r=await ctx.licenses().issue(u.actor,u.envelope(),now);
 expect(r.expiresAtMs).toBe(now+1800000);expect(ctx.count('credit_reservations')).toBe(0);
 const [h,b,s]=r.license.split('.');expect(verify('sha256',Buffer.from(h+'.'+b),{key:ctx.signer.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url'))).toBe(true);
 expect(JSON.parse(Buffer.from(b,'base64url').toString())).toMatchObject({execution:'on_device',componentProfile:'apple-system-zh-en-v10-r1',allowedLanguages:['zh','en']});
});
it('clips the permit to a known trial or paid expiry without preparation grace',async()=>{
 ctx=setup();const u=await ctx.owner('alice');ctx.f.db.prepare('UPDATE v10_subscription_transactions SET expires_ms=?').run(now+12345);
 const r=await ctx.licenses().issue(u.actor,u.envelope(),now);expect(r.expiresAtMs).toBe(now+12345);
 await expect(ctx.licenses().issue(u.actor,u.envelope({requestKey:'b'.repeat(64),issuedAtMs:now+12345}),now+12345)).rejects.toThrow('v10_entitlement_expired');
});
it('replays exact acquisition without a new expiry, and rejects a new launch until the old lease is terminal',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),body=u.envelope(),a=await ctx.licenses().issue(u.actor,body,now),b=await ctx.licenses().issue(u.actor,body,now+1000);expect(b).toEqual(a);expect(ctx.count('v10_device_licenses')).toBe(1);
 await expect(ctx.licenses().issue(u.actor,u.envelope({requestKey:'b'.repeat(64),launchNonce:'launch-alice'}),now)).rejects.toThrow('v10_device_license_already_active');
});
it('does not impose a global ASR slot on ten separate phone owners',async()=>{
 ctx=setup();for(let n=0;n<10;n++){const u=await ctx.owner('u'+n);await ctx.licenses().issue(u.actor,u.envelope(),now);}
 expect(ctx.count('v10_device_licenses')).toBe(10);expect(ctx.count('credit_reservations')).toBe(0);
});
it('a copied envelope cannot be modified for a different request or owner',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),e=u.envelope(),body=JSON.parse(Buffer.from(e.clientData,'base64').toString());body.requestKey='b'.repeat(64);
 await expect(ctx.licenses().issue(u.actor,{...e,clientData:Buffer.from(JSON.stringify(body)).toString('base64')},now)).rejects.toThrow('v10_device_signature');
});
it('renews with a new signed sequence starting at the old end, and does not change the old receipt',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),a=await ctx.licenses().issue(u.actor,u.envelope(),now);
 const at=now+1740000,b=await ctx.licenses().issue(u.actor,u.envelope({operation:'renew',leaseId:a.leaseId,sequence:1,requestKey:'b'.repeat(64),issuedAtMs:at}),at);
 expect(b.sequence).toBe(2);expect(b.notBeforeMs).toBe(at);expect(b.expiresAtMs).toBe(at+1800000);expect(a.expiresAtMs).toBe(now+1800000);
});
it('issues only through a freshly verified billing grace deadline',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),chain=ctx.subscriptions().chainKey(u.transaction);
 ctx.config['requireFreshStatus']=true;
 ctx.f.db.prepare('UPDATE v10_subscription_transactions SET expires_ms=? WHERE owner_id=?').run(now-1,'alice');
 ctx.f.db.prepare('INSERT INTO v10_subscription_status VALUES(?,?,?,?,?,?,?,?,?)').run(chain,'alice',now,now,4,0,1,now+12345,'synthetic');
 expect(await ctx.subscriptions().entitlement('alice',now)).toMatchObject({valid:true,status:'grace',expiresAtMs:now+12345});
 const r=await ctx.licenses().issue(u.actor,u.envelope(),now);
 expect(r.expiresAtMs).toBe(now+12345);
});
