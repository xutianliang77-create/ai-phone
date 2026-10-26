import {afterEach,it,expect,vi} from 'vitest';
import {startV10ProcessingApi} from './v10-control-main.js';
import {getStoreSnapshot,createEmptyStoreSnapshot} from './infrastructure/storage/json-store.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('starts closed without sweeping legacy state, calling a model or initializing a wallet',async()=>{
 for(const[k,v]of Object.entries({V10_CONTROL_AUTHORITY:'cloudflare',V10_CONTROL_DEPLOYMENT_ID:'wujie-v10-fixture',API_BIND_HOST:'127.0.0.1',API_PORT:'0',V10_SERVICE_ADMISSION_ENABLED:'false',LOG_LEVEL:'silent'}))vi.stubEnv(k,v);
 const store=getStoreSnapshot();Object.assign(store,createEmptyStoreSnapshot());store.sessions.push({id:'legacy-unknown',userId:'owner',mode:'conversation',status:'active',consumedSeconds:0,createdAt:'2020-01-01T00:00:00Z',segments:[]});
 const before=JSON.stringify(store),outbound=vi.fn(()=>{throw Error('No outbound allowed');});vi.stubGlobal('fetch',outbound);
 const app=await startV10ProcessingApi();
 try{const r=await app.inject({method:'POST',url:'/realtime/sessions',payload:{}});expect(r.statusCode).toBe(503);expect(JSON.stringify(store)).toBe(before);expect(outbound).not.toHaveBeenCalled();}
 finally{await app.close();}
});
