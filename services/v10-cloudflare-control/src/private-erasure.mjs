import {createHmac} from 'node:crypto';
import {sql,command,activeAccount} from '../vendor/reused-control-core.mjs';
import {deployment,context,sha} from './environment.mjs';
import {fail,strongKey} from './protocol.mjs';
const domain='wujie.v10-control.private-erasure.v1';
/** Record intent before revoking authentication. A crash cannot silently drop
 * the content request. An active account's intent is never executed. */
export async function prepareErasure(ctx,actor,now){
 const id='v10-erasure:'+sha([ctx.deploymentId,actor.id]);
 const c=command(id,actor.id,'v10.private-erasure.request',{ownerId:actor.id},now);
 await ctx.store.execute(c,{statements:[activeAccount(c,actor.authorizationEpoch),
  sql("INSERT INTO v10_private_erasure(owner_id,request_id,state,created_ms,updated_ms) VALUES (?,?,'pending',?,?) ON CONFLICT(owner_id) DO NOTHING",actor.id,id,now,now)],
  receipt:sql("SELECT json_object('requestId',?,'status','pending') AS receipt",id)});
 return id;
}
export async function processErasure(env,ownerId){
 const ctx=await context(env,false),now=Date.now();
 const row=await ctx.store.read(sql(`SELECT e.* FROM v10_private_erasure e JOIN accounts a ON a.user_id=e.owner_id
  WHERE e.owner_id=? AND e.state='pending' AND a.status='deletion_requested'`,ownerId));
 if(!row)return;
 const pending=await ctx.store.read(sql("SELECT COUNT(*) n FROM public_sessions WHERE owner_id=? AND state<>'ended'",ownerId));
 if(pending.n>0)return; // Neither an expired hold nor an unknown close proves safe erasure.
 if(!strongKey(env.INTERNAL_API_SECRET))fail('v10_erasure_not_configured');
 const data=Buffer.from(JSON.stringify({domain,deploymentId:deployment(env),ownerId,requestId:row.request_id,issuedAtMs:now})).toString('base64url');
 const proof=data+'.'+createHmac('sha256',env.INTERNAL_API_SECRET).update(domain+'\0'+data).digest('base64url');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);let code='unconfirmed';
 try{
  const url=new URL('/internal/v10/account/erase',env.V10_PROCESSING_API_BASE_URL);if(url.protocol!=='https:')fail('v10_processing_api');
  const response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({proof}),signal:controller.signal});
  const value=await response.json();
  if(!response.ok||value.requestId!==row.request_id||value.ownerId!==ownerId||value.status!=='completed')fail('v10_erasure_unconfirmed');
  await ctx.store.execute(command(row.request_id+':completed',ownerId,'v10.private-erasure.completed',{receiptHash:sha(value)},now),{
   statements:[sql("UPDATE v10_private_erasure SET state='completed',updated_ms=?,attempts=attempts+1,last_code=NULL,receipt_hash=? WHERE owner_id=? AND state='pending'",now,sha(value),ownerId)],receipt:sql("SELECT json_object('status','completed') AS receipt")});
  return;
 }catch{code='private_service_unconfirmed';}
 finally{clearTimeout(timer);}
 await ctx.store.execute(command(row.request_id+':attempt:'+now,ownerId,'v10.private-erasure.attempt',{code},now),{
  statements:[sql("UPDATE v10_private_erasure SET updated_ms=?,attempts=attempts+1,last_code=? WHERE owner_id=? AND state='pending'",now,code,ownerId)],receipt:sql("SELECT json_object('status','pending') AS receipt")});
}
export async function pendingErasures(env){
 const ctx=await context(env,false);
 const rows=await ctx.store.readAll(sql("SELECT owner_id FROM v10_private_erasure WHERE state='pending' ORDER BY updated_ms LIMIT 4"));
 for(const row of rows)await processErasure(env,row.owner_id);
}
