import {it,expect,afterEach} from 'vitest';
import {sign} from 'node:crypto';
import {setup,now} from './control-fixture.js';
let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
it('recovers the exact lost POST response, including after request freshness elapsed',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),body=u.envelope(),r=await ctx.licenses().issue(u.actor,body,now);
 expect(await ctx.licenses().resolve(u.actor,body,now+31000)).toEqual({status:'issued',...r});
 expect(ctx.count('v10_device_licenses')).toBe(1);
});
it('tombstones an absent request, so a delayed POST cannot resurrect it',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),e=u.envelope();
 expect(await ctx.licenses().resolve(u.actor,e,now)).toEqual({status:'cancelled'});
 expect(await ctx.licenses().resolve(u.actor,e,now+1000)).toEqual({status:'cancelled'});
 await expect(ctx.licenses().issue(u.actor,e,now+1000)).rejects.toThrow();
 expect(ctx.count('v10_device_licenses')).toBe(0);
});
it('a new native launch can supersede only its own device lease without a financial release',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),a=await ctx.licenses().issue(u.actor,u.envelope(),now);
 const b=await ctx.licenses().issue(u.actor,u.envelope({requestKey:'b'.repeat(64),launchNonce:'new-process'}),now+1);
 expect(b.leaseId).not.toBe(a.leaseId);
 expect(ctx.f.db.prepare('SELECT state FROM v10_device_licenses WHERE lease_id=?').get(a.leaseId)?.state).toBe('closed');
 expect(ctx.count('credit_reservations')).toBe(0);
});
it('rejects stale renewal sequences and never recovers a replaced old receipt',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),a=await ctx.licenses().issue(u.actor,u.envelope(),now),at=now+1740000;
 await ctx.licenses().issue(u.actor,u.envelope({operation:'renew',leaseId:a.leaseId,sequence:1,issuedAtMs:at,requestKey:'b'.repeat(64)}),at);
 expect(await ctx.licenses().resolve(u.actor,u.envelope(),at)).toEqual({status:'ended'});
 await expect(ctx.licenses().issue(u.actor,u.envelope({operation:'renew',leaseId:a.leaseId,sequence:1,issuedAtMs:at,requestKey:'c'.repeat(64)}),at)).rejects.toThrow('v10_license_renewal_conflict');
});
it('refund and login revocation fence acquisition and old response recovery',async()=>{
 ctx=setup();const u=await ctx.owner('alice');await ctx.licenses().issue(u.actor,u.envelope(),now);
 ctx.f.db.prepare('UPDATE v10_subscription_transactions SET revoked_ms=?').run(now+1);
 expect(await ctx.licenses().resolve(u.actor,u.envelope(),now+2)).toEqual({status:'ended'});
 ctx.f.db.prepare('UPDATE account_tokens SET revoked_ms=?').run(now+2);
 await expect(ctx.licenses().issue(u.actor,u.envelope(),now+3)).rejects.toThrow('v10_auth_required');
});
it('clips a valid subscription to the authorization or QA end, and closed admission refuses renewal',async()=>{
 ctx=setup();const u=await ctx.owner('alice');ctx.config['windowEndMs']=now+30000;
 const a=await ctx.licenses().issue(u.actor,u.envelope(),now);expect(a.expiresAtMs).toBe(now+30000);
 ctx.config.admissionOpen=false;
 await expect(ctx.licenses().issue(u.actor,u.envelope(),now+1)).rejects.toThrow('v10_license_admission_closed');
});
it('a late device stop has one statistics row and unique receipt, with no seconds charged',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),a=await ctx.licenses().issue(u.actor,u.envelope(),now);
 const body={domain:'wujie.v10.device-license.close.v1',ownerId:u.actor.id,deploymentId:ctx.config.deploymentId,
  devicePublicKey:u.raw.toString('base64'),leaseId:a.leaseId,launchNonce:'launch-alice',sequence:1,activeMs:120000,issuedAtMs:now+1800000,reason:'expired'};
 const data=Buffer.from(JSON.stringify(body)),e={clientData:data.toString('base64'),deviceSignature:sign('sha256',data,{key:u.device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};
 const r=await ctx.licenses().close(e,now+86400000);
 expect(r).toMatchObject({status:'closed',chargedSeconds:0,meterBasis:'device_reported_statistics'});
 expect(await ctx.licenses().close(e,now+86401000)).toEqual(r);
 expect(ctx.count('v10_device_statistics')).toBe(1);expect(ctx.count('credit_ledger')).toBe(0);
});
it('a delayed old-sequence stop cannot close a newer recovered renewal',async()=>{
 ctx=setup();const u=await ctx.owner('alice'),a=await ctx.licenses().issue(u.actor,u.envelope(),now),at=now+1740000;
 await ctx.licenses().issue(u.actor,u.envelope({operation:'renew',leaseId:a.leaseId,sequence:1,issuedAtMs:at,requestKey:'b'.repeat(64)}),at);
 const stop=(sequence:number)=>{const body={domain:'wujie.v10.device-license.close.v1',ownerId:u.actor.id,deploymentId:ctx.config.deploymentId,
  devicePublicKey:u.raw.toString('base64'),leaseId:a.leaseId,launchNonce:'launch-alice',sequence,activeMs:12345,issuedAtMs:at,reason:'expired'},d=Buffer.from(JSON.stringify(body));
  return {clientData:d.toString('base64'),deviceSignature:sign('sha256',d,{key:u.device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};};
 expect((await ctx.licenses().close(stop(1),at+60001)).sequence).toBe(1);
 expect(ctx.f.db.prepare('SELECT state FROM v10_device_licenses WHERE lease_id=?').get(a.leaseId)?.state).toBe('active');
 await ctx.licenses().close(stop(2),at+1800000);
 expect(ctx.count('v10_device_statistics')).toBe(2);expect(ctx.count('credit_ledger')).toBe(0);
});
