import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Fixture,now} from './fixture.js';
import {prepareErasure,processErasure} from '../src/private-erasure.mjs';
const did='wujie-v10-erasure-fixture';let f:Fixture,tokenHash:string;
const env={PUBLIC_DEPLOYMENT_ID:did,COMMERCE_WRITER_FENCE:'1',CF_RECOVERY_EPOCH:'1',INTERNAL_API_SECRET:'fixture-erasure-internal-secret-32-bytes',V10_PROCESSING_API_BASE_URL:'https://processing.beelinkdata.com'};
beforeEach(()=>{
 f=new Fixture();f.db.exec(readFileSync(new URL('./sql/commerce/0010_v10_private_erasure.sql',import.meta.url),'utf8'));
 tokenHash=f.seedUser('owner').tokenHash;
});
afterEach(()=>{f.close();vi.unstubAllGlobals();});
async function intent(){return prepareErasure({store:f.store(),deploymentId:did},{id:'owner',authorizationEpoch:1,tokenHash},now);}
it('persists deletion intent without processing an active account',async()=>{
 await intent();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await processErasure({...env,D1_COMMERCE:f},'owner');
 expect(fetch).not.toHaveBeenCalled();expect(f.db.prepare('SELECT state FROM v10_private_erasure').get()).toMatchObject({state:'pending'});
});
it('keeps an unconfirmed private request pending and retries only that new owner',async()=>{
 const requestId=await intent();f.db.exec("UPDATE accounts SET status='deletion_requested'");
 const fetch=vi.fn(async()=>{throw Error('lost response');});vi.stubGlobal('fetch',fetch);
 await processErasure({...env,D1_COMMERCE:f},'owner');expect(f.db.prepare('SELECT state,attempts FROM v10_private_erasure').get()).toMatchObject({state:'pending',attempts:1});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ownerId:'owner',requestId,status:'completed'})));
 await processErasure({...env,D1_COMMERCE:f},'owner');expect(f.db.prepare('SELECT state,attempts FROM v10_private_erasure').get()).toMatchObject({state:'completed',attempts:2});
});
