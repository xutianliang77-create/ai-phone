import {afterEach,expect,it} from 'vitest';
import {sign} from 'node:crypto';
import {setup,now} from './control-fixture.js';

let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());
it('isolates ten accounts over a simulated 15-minute period and closes each license once',async()=>{
 ctx=setup();
 const users=[];for(let i=0;i<10;i++)users.push(await ctx.owner('load-'+i));
 Object.assign(ctx.config,{requireFreshStatus:true});
 for(const u of users){
  const chain=ctx.subscriptions().chainKey(u.transaction);
  ctx.f.db.prepare('INSERT INTO v10_subscription_status VALUES(?,?,?,?,?,?,?,?,?)')
   .run(chain,u.actor.id,now,now,1,1,0,null,'a'.repeat(64));
 }
 const starts=await Promise.all(users.map(u=>ctx.licenses().issue(u.actor,u.envelope(),now)));
 expect(new Set(starts.map(x=>x.leaseId)).size).toBe(10);
 for(let i=0;i<10;i++){
  const claims=JSON.parse(Buffer.from(starts[i].license.split('.')[1],'base64url').toString());
  expect(claims.ownerId).toBe(users[i].actor.id);
  expect(starts[i].expiresAtMs).toBeGreaterThan(now+900000);
 }
 const closes=users.map((u,i)=>{
  const body={domain:'wujie.v10.device-license.close.v1',ownerId:u.actor.id,deploymentId:ctx.config.deploymentId,
   devicePublicKey:u.raw.toString('base64'),leaseId:starts[i].leaseId,launchNonce:'launch-'+u.actor.id,
   sequence:1,activeMs:900000,issuedAtMs:now+900000,reason:'ended'};
  const bytes=Buffer.from(JSON.stringify(body));return {clientData:bytes.toString('base64'),
   deviceSignature:sign('sha256',bytes,{key:u.device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};
 });
 const completed=await Promise.all(closes.map(p=>ctx.licenses().close(p,now+900000)));
 expect(completed.every(r=>r.status==='closed'&&r.chargedSeconds===0)).toBe(true);
 await Promise.all(closes.map(p=>ctx.licenses().close(p,now+900001)));
 expect(ctx.count('v10_device_licenses')).toBe(10);
 expect(ctx.count('v10_device_statistics')).toBe(10);
 expect(ctx.count('credit_ledger')).toBe(0);
 expect(ctx.count('credit_reservations')).toBe(0);
});
