import {afterEach,expect,it} from 'vitest';
import {sign} from 'node:crypto';
import {setup,now} from './control-fixture.js';

let ctx:ReturnType<typeof setup>;
afterEach(()=>ctx?.f.close());

it.each(['close-before-new','close-after-new'] as const)(
  'a signed old stop leaves the new lease active: %s', async order=>{
    ctx=setup();
    const user=await ctx.owner('alice');
    const old=await ctx.licenses().issue(user.actor,user.envelope(),now);
    const body={domain:'wujie.v10.device-license.close.v1',ownerId:user.actor.id,
      deploymentId:ctx.config.deploymentId,devicePublicKey:user.raw.toString('base64'),
      leaseId:old.leaseId,launchNonce:'launch-alice',sequence:1,activeMs:12000,
      issuedAtMs:now+1,reason:'expired'};
    const bytes=Buffer.from(JSON.stringify(body));
    const receipt={clientData:bytes.toString('base64'),
      deviceSignature:sign('sha256',bytes,{key:user.device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};
    if(order==='close-before-new')await ctx.licenses().close(receipt,now+2);
    const next=await ctx.licenses().issue(user.actor,
      user.envelope({requestKey:'b'.repeat(64),launchNonce:'new-process'}),now+3);
    const acknowledgement=await ctx.licenses().close(receipt,now+4);
    expect(await ctx.licenses().close(receipt,now+5)).toEqual(acknowledgement);
    expect(acknowledgement).toMatchObject({leaseId:old.leaseId,sequence:1,status:'closed',chargedSeconds:0});
    expect(next.leaseId).not.toBe(old.leaseId);
    expect(ctx.f.db.prepare('SELECT state FROM v10_device_licenses WHERE lease_id=?').get(next.leaseId)?.state).toBe('active');
    expect(ctx.count('v10_device_statistics')).toBe(1);
    expect(ctx.count('credit_ledger')).toBe(0);
  },
);
