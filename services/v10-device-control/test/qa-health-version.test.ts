import {expect,it} from 'vitest';
import worker from '../src/worker.mjs';

const version='12345678-1234-4234-8234-123456789abc';
const base={PUBLIC_DEPLOYMENT_ID:'wujie-v10-device-fixture',PUBLIC_BUNDLE_ID:'cn.qkxy.wujieai.public',
 BILLING_ENVIRONMENT:'Sandbox',PUBLIC_RELEASE_PURPOSE:'A13_QA',V10_DEVICE_LICENSE_ENABLED:'false'};
async function health(env:Record<string,unknown>){
 const response=await worker.fetch(new Request('https://www.beelinkdata.com/health'),env,{} as never);
 expect(response.status).toBe(200);
 return await response.json() as Record<string,unknown>;
}
it('QA health identifies the exact edge version from the bound metadata',async()=>{
 const result=await health({...base,CF_VERSION_METADATA:{id:version}});
 expect(result.qaWorkerVersion).toBe(version);
 expect(result.licenseAdmission).toBe('closed');
});
it('missing or invalid metadata is explicit and cannot impersonate a version',async()=>{
 expect((await health(base)).qaWorkerVersion).toBeNull();
 expect((await health({...base,CF_VERSION_METADATA:{id:'not-a-valid-version'}})).qaWorkerVersion).toBeNull();
});
it('production or non-QA health never exposes the QA version field',async()=>{
 expect(await health({...base,BILLING_ENVIRONMENT:'Production',CF_VERSION_METADATA:{id:version}})).not.toHaveProperty('qaWorkerVersion');
 expect(await health({...base,PUBLIC_RELEASE_PURPOSE:'PRODUCTION',CF_VERSION_METADATA:{id:version}})).not.toHaveProperty('qaWorkerVersion');
});
