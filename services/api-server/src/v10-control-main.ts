import {existsSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildApp} from './app.js';
import {loadEnv} from './config/env.js';
import {initializeRepositoryRuntime} from './infrastructure/storage/repository-runtime.js';
import {usesSharedControl,controlDeployment} from './modules/account/shared-control-client.js';

/** Retained processing entry for independent Cloudflare control. Deliberately
 * does not import/start the legacy recovery, sweep, outbox or agent workers. */
export async function startV10ProcessingApi(){
 if(!usesSharedControl())throw Error('V10_CONTROL_AUTHORITY must be cloudflare');
 controlDeployment();
 const env=loadEnv();
 if(!['127.0.0.1','::1'].includes(env.apiHost))throw Error('Retained API must bind loopback behind the approved ingress');
 if(process.env.NODE_ENV==='production'){
  const file=process.env.API_SQLITE_FILE;
  if(process.env.API_STORAGE_DRIVER!=='sqlite'||!file||!isAbsolute(file)||!existsSync(file))throw Error('An existing, backed-up SQLite processing store is required');
 }
 const repository=await initializeRepositoryRuntime(),app=await buildApp();
 app.addHook('onClose',()=>repository.close());
 await app.listen({host:env.apiHost,port:env.apiPort});
 return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).toString()){
 const app=await startV10ProcessingApi();
 const close=()=>{void app.close().then(()=>{process.exitCode=0;});};
 process.once('SIGINT',close);process.once('SIGTERM',close);
}
