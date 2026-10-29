import {afterEach,expect,it} from 'vitest';
import {setup,now} from './control-fixture.js';
import {COMPONENT_PROFILE_V2,IMPLEMENTATION_HASH_V2} from '../src/component-profile.mjs';

let ctx:ReturnType<typeof setup>;afterEach(()=>ctx?.f.close());

it('defaults v2 off; enabling it cannot grant unqualified languages or extend expiry',async()=>{
 ctx=setup();const u=await ctx.owner('alice');
 const p={profile:COMPONENT_PROFILE_V2.profile,implementationHash:IMPLEMENTATION_HASH_V2};
 await expect(ctx.licenses().issue(u.actor,u.envelope(p),now)).rejects.toThrow('v10_license_contract');
 ctx.config['capabilityProfileV2Enabled']=true;
 ctx.config['windowEndMs']=now+30000;
 const receipt=await ctx.licenses().issue(u.actor,u.envelope(p),now);
 const claims=JSON.parse(Buffer.from(receipt.license.split('.')[1],'base64url').toString());
 expect(claims).toMatchObject({version:2,componentProfile:p.profile,implementationHash:p.implementationHash,
  allowedLanguages:['zh','en'],expiresAtMs:now+30000});
 expect(ctx.count('v10_device_licenses')).toBe(1);
});

it('does not permit a v1 lease to renew as v2 or accept a mismatched hash',async()=>{
 ctx=setup();ctx.config['capabilityProfileV2Enabled']=true;const u=await ctx.owner('alice');
 const first=await ctx.licenses().issue(u.actor,u.envelope(),now),at=now+1740000;
 const renewal={profile:COMPONENT_PROFILE_V2.profile,implementationHash:IMPLEMENTATION_HASH_V2,
  operation:'renew',leaseId:first.leaseId,sequence:1,requestKey:'b'.repeat(64),issuedAtMs:at};
 await expect(ctx.licenses().issue(u.actor,u.envelope(renewal),at)).rejects.toThrow('v10_license_renewal_conflict');
 await expect(ctx.licenses().issue(u.actor,u.envelope({...renewal,implementationHash:'0'.repeat(64)}),at)).rejects.toThrow('v10_license_contract');
 expect(ctx.f.db.prepare('SELECT sequence FROM v10_device_licenses WHERE lease_id=?').get(first.leaseId)?.sequence).toBe(1);
});
