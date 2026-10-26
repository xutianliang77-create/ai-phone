import {afterEach,describe,it,expect,vi} from 'vitest';
import {SharedControlClient} from './shared-control-client.js';
describe('control reads reconnect within one budget, mutations never retry',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('reconnects a failed read once and caches only verified deployment identity',async()=>{
  vi.stubEnv('V10_CONTROL_DEPLOYMENT_ID','wujie-v10-fixture');let reads=0;
  const fetchFn=vi.fn(async(url:string)=>{if(url.endsWith('/auth/deployment')){reads++;if(reads===1)throw Error('lost read');return Response.json({deploymentId:'wujie-v10-fixture',backend:'cloudflare'});}return Response.json({availableSeconds:0});});
  const client=new SharedControlClient(fetchFn as typeof fetch);
  await client.request('/usage/balance','GET');await client.request('/usage/balance','GET');expect(reads).toBe(2);
  expect(fetchFn).toHaveBeenCalledTimes(4);
 });
 it('does not resend an uncertain authorize or finish POST',async()=>{
  vi.stubEnv('V10_CONTROL_DEPLOYMENT_ID','wujie-v10-fixture');let posts=0;
  const client=new SharedControlClient((async(url:string,init:RequestInit)=>{
   if(url.endsWith('/auth/deployment'))return Response.json({deploymentId:'wujie-v10-fixture',backend:'cloudflare'});
   if(init.method==='POST')posts++;throw Error('uncertain write');
  }) as typeof fetch);
  await expect(client.request('/v10/control/finish','POST',{})).rejects.toThrow('shared_control_unavailable');expect(posts).toBe(1);
 });
});
