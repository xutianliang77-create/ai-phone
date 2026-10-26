import {createHmac,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {getRepositoryRuntime} from '../../infrastructure/storage/repository-runtime.js';
import {getStoreSnapshot,persistStoreSnapshot,runStoreTransaction} from '../../infrastructure/storage/json-store.js';
import {usesSharedControl,controlDeployment,SharedControlError} from './shared-control-client.js';
const domain='wujie.v10-control.private-erasure.v1';
export function registerControlPrivateErasure(app:FastifyInstance){
 app.post('/internal/v10/account/erase',async request=>{
  if(!usesSharedControl())throw new SharedControlError('control_erasure_not_enabled');
  const value=(request.body as {proof?:unknown})?.proof,secret=process.env.INTERNAL_API_SECRET;
  if(typeof value!=='string'||value.length>4096||!secret||secret.length<32)throw new SharedControlError('control_erasure_proof',403);
  const [data,sig,extra]=value.split('.'),actual=Buffer.from(sig??'','base64url'),expected=createHmac('sha256',secret).update(domain+'\0'+data).digest();
  if(extra||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new SharedControlError('control_erasure_proof',403);
  let body:{domain:string;ownerId:string;deploymentId:string;requestId:string;issuedAtMs:number};
  try{body=JSON.parse(Buffer.from(data,'base64url').toString());}catch{throw new SharedControlError('control_erasure_proof',403);}
  if(body.domain!==domain||body.deploymentId!==controlDeployment()||!/^v10-erasure:[a-f0-9]{64}$/.test(body.requestId)||
   !/^[A-Za-z0-9_-]{1,160}$/.test(body.ownerId)||!Number.isSafeInteger(body.issuedAtMs)||Math.abs(Date.now()-body.issuedAtMs)>30000)throw new SharedControlError('control_erasure_binding',403);
  // The retained 1.0 deployment uses SQLite. Never silently erase a partial PG
  // projection or declare an unsupported backend complete.
  if(getRepositoryRuntime().driver==='postgres')throw new SharedControlError('control_erasure_storage_not_ready');
  return runStoreTransaction(()=>{
   const store=getStoreSnapshot(),owned=store.sessions.filter(s=>s.userId===body.ownerId);
   if(owned.some(s=>s.status!=='ended'))throw new SharedControlError('control_erasure_pending_session',409);
   for(const s of owned){s.segments=[];s.review=null;delete s.diagnostics;}
   store.termbaseTerms=store.termbaseTerms.filter(t=>t.userId!==body.ownerId);
   // Deferred AI/call/voice enrollment is closed in this core release. Unexpected
   // legacy material must be reviewed, not silently classified as deleted.
   if(store.agentCallDrafts.some(d=>d.userId===body.ownerId)||store.voiceProfiles.some(p=>p.userId===body.ownerId))throw new SharedControlError('control_erasure_legacy_material_pending',409);
   persistStoreSnapshot();
   return {requestId:body.requestId,ownerId:body.ownerId,status:'completed',retained:'accounting_session_metadata'};
  });
 });
}
