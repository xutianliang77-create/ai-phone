import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createHmac,createHash} from 'node:crypto';
import {buildApp} from '../../app.js';
import {getStoreSnapshot,createEmptyStoreSnapshot} from '../../infrastructure/storage/json-store.js';
const secret='fixture-private-erasure-secret-32-bytes',deployment='wujie-v10-erasure-fixture';
let app:Awaited<ReturnType<typeof buildApp>>;
beforeEach(async()=>{
 vi.stubEnv('V10_CONTROL_AUTHORITY','cloudflare');vi.stubEnv('V10_CONTROL_DEPLOYMENT_ID',deployment);vi.stubEnv('INTERNAL_API_SECRET',secret);vi.stubEnv('V10_SERVICE_ADMISSION_ENABLED','false');
 Object.assign(getStoreSnapshot(),createEmptyStoreSnapshot());app=await buildApp();
});
afterEach(async()=>{await app.close();vi.unstubAllEnvs();});
function request(ownerId='owner',key=secret){const domain='wujie.v10-control.private-erasure.v1',requestId='v10-erasure:'+createHash('sha256').update(ownerId).digest('hex');
 const data=Buffer.from(JSON.stringify({domain,ownerId,deploymentId:deployment,requestId,issuedAtMs:Date.now()})).toString('base64url');
 return app.inject({method:'POST',url:'/internal/v10/account/erase',payload:{proof:data+'.'+createHmac('sha256',key).update(domain+'\0'+data).digest('base64url')}});
}
function seed(status:'active'|'ended'='ended'){
 const store=getStoreSnapshot();store.sessions.push({id:'owned',userId:'owner',status,mode:'conversation',consumedSeconds:12,createdAt:new Date().toISOString(),segments:[{id:'s',sourceText:'private source',translatedText:'private translation'}],billingAuthority:'cloudflare_v10',gatewayFinalizationReceipt:'retained-accounting-proof'});
 store.sessions.push({id:'other',userId:'another-owner',status:'ended',mode:'conversation',consumedSeconds:1,createdAt:new Date().toISOString(),segments:[{id:'s',sourceText:'other source',translatedText:'other translation'}]});return store;
}
it('rejects unsigned or wrongly signed erase operations',async()=>{
 const store=seed();expect((await request('owner','wrong-key')).statusCode).toBe(403);expect(store.sessions[0].segments.length).toBe(1);
});
it('retains the whole owner content while any session lacks a terminal state',async()=>{
 seed('active');expect((await request()).statusCode).toBe(409);expect(getStoreSnapshot().sessions[0].segments.length).toBe(1);
});
it('erases only the requested content after stop and keeps accounting metadata on replay',async()=>{
 const store=seed(),a=await request();expect(a.statusCode).toBe(200);const b=await request();expect(b.json()).toEqual(a.json());
 expect(store.sessions[0]).toMatchObject({id:'owned',consumedSeconds:12,gatewayFinalizationReceipt:'retained-accounting-proof',segments:[]});expect(store.sessions[1].segments.length).toBe(1);
 expect(store.usageBalances).toEqual({});expect(store.billingLedger).toEqual([]);
});
