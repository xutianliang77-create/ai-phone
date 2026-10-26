import {prepareErasure,processErasure} from './private-erasure.mjs';
import {requirePublicDocuments,publicDocumentJson,readJson,onlyKeys,D1UsageHoldsRepository,sql} from '../vendor/reused-control-core.mjs';
import {authorize,deployment,sha} from './environment.mjs';
import {fail} from './protocol.mjs';
export async function accountRoute(request,env,ctx,now,execution){
 const path=new URL(request.url).pathname,authorization=request.headers.get('authorization')??undefined;
 if(path==='/auth/apple/request'||path==='/auth/apple/login'){
  requirePublicDocuments(env);if(request.method!=='POST')fail('v10_method_not_allowed');
  const body=await readJson(request,65536);if(body.deploymentId!==deployment(env))fail('v10_deployment_binding');
  if(path.endsWith('/request')){
   onlyKeys(body,['deploymentId','action']);if(body.action!=='login')fail('v10_action_not_supported');
   return {ok:true,...await ctx.account.beginSignIn(now),deploymentId:deployment(env),privacyVersion:env.PRIVACY_VERSION,termsVersion:env.TERMS_VERSION,documentSetHash:sha(publicDocumentJson(env))};
  }
  onlyKeys(body,['deploymentId','challengeId','state','bindingSecret','identityToken','authorizationCode','agreements']);
  const result=await ctx.account.completeSignIn(body,now);
  return {ok:true,token:result.bearerToken,expiresAt:result.expiresAt,account:{...result.account,phoneMasked:''},deploymentId:deployment(env)};
 }
 if(path==='/auth/logout'&&request.method==='POST'){await ctx.account.logout(authorization,now);return {status:'ok'};}
 if(path==='/account/delete'&&request.method==='POST'){
  const actor=await authorize(ctx,request,now);ctx.deploymentId=deployment(env);
  await prepareErasure(ctx,actor,now);
  const result=await ctx.account.requestDeletion(authorization,now);
  // Only the newly requested owner's revocations are processed. No global queue,
  // historical sweep, data migration, compensating grant or model call starts.
  const rows=await ctx.store.readAll(sql("SELECT event_id FROM finance_outbox WHERE owner_id=? AND event_type='apple.revoke' AND state='pending' ORDER BY created_ms DESC LIMIT 5",result.account.id));
  const work=(async()=>{for(const row of rows)await ctx.account.processRevocation(row.event_id,Date.now()).catch(()=>undefined);})();
  execution?.waitUntil(work);
  execution?.waitUntil(processErasure(env,result.account.id));
  return {account:{...result.account,phoneMasked:''},deletion:{status:'awaiting_safe_terminal'}};
 }
 const actor=await authorize(ctx,request,now);
 if(path==='/account/me'&&request.method==='GET')return {account:{...actor.account,phoneMasked:''}};
 await ctx.surface.ready();
 if(path==='/account/consents'&&request.method==='GET')return ctx.surface.consents(actor);
 if(path==='/account/consents'&&request.method==='POST'){
  const body=await readJson(request,65536);onlyKeys(body,['consentType','version','scene','acceptedAt','source','locale']);return ctx.surface.recordConsent(actor,body,now,request.headers.get('idempotency-key')??undefined);
 }
 if(path==='/usage/balance'&&request.method==='GET')return {...await new D1UsageHoldsRepository(ctx.store,deployment(env)).balance(actor.id),subscribed:false};
 if(path==='/billing/ledger'&&request.method==='GET')return ctx.surface.ledger(actor.id);
 if(path==='/billing/products'&&request.method==='GET')return {products:[]};
 if(path==='/account/export'&&request.method==='GET'){const ledger=await ctx.surface.ledger(actor.id);return {exportedAt:new Date(now).toISOString(),account:{...actor.account,phoneMasked:''},...await ctx.surface.consents(actor),
  usage:await new D1UsageHoldsRepository(ctx.store,deployment(env)).balance(actor.id),billingLedger:ledger.ledger??[],sessions:[],termbaseTerms:[],agentCalls:[],
  privateDataExportRequired:true};}
 fail('v10_route_not_supported');
}
