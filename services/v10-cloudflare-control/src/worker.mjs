import {pendingErasures} from './private-erasure.mjs';
import {verifyProcessingIssue} from './processing-proof.mjs';
import {readJson,publicDocumentJson,requirePublicDocuments,GatewayDeviceRegistration,AppAttestVerifier} from '../vendor/reused-control-core.mjs';
import {context,deployment,authorize,policy,ownerAllowed,sha} from './environment.mjs';
import {accountRoute} from './account.mjs';
import {V10ControlService} from './control-service.mjs';
import {fail} from './protocol.mjs';
const accountPaths=new Set(['/auth/apple/request','/auth/apple/login','/auth/logout','/account/me','/account/delete','/account/consents','/account/export','/usage/balance','/billing/products','/billing/ledger']);
const documentPaths=new Set(['/','/privacy','/terms','/support','/refund','/account/delete','/providers','/permissions']);
export default {async scheduled(event,env,execution){execution.waitUntil(pendingErasures(env));},async fetch(request,env,execution){
 const begin=Date.now(),url=new URL(request.url),path=url.pathname;let ctx;
 if(url.origin!=='https://www.beelinkdata.com')return json({error:{code:'v10_origin_binding'}},undefined,begin,404);
 try{
  if(path==='/auth/deployment'&&request.method==='GET')return json({deploymentId:deployment(env),backend:'cloudflare',bundleId:env.PUBLIC_BUNDLE_ID,
   processingApiBaseUrl:env.V10_PROCESSING_API_BASE_URL,gatewayEndpoint:env.V10_PRIVATE_GATEWAY_ENDPOINT,controlContract:'v10-control-proof-v1'});
  if(path==='/health'&&request.method==='GET')return json({status:'ok',service:'wujie-v10-control',deploymentId:deployment(env),modelAdmission:policy(env,begin).enabled?'configured_open':'closed'});
  if(documentPaths.has(path)&&(request.method==='GET'||request.method==='HEAD'))return documents(env,path,request.method==='HEAD');
  if(!accountPaths.has(path)&&!path.startsWith('/v10/control/'))fail('v10_route_not_supported');
  ctx=await context(env,!['/v10/control/finish','/v10/control/serving'].includes(path));
  if(accountPaths.has(path))return json(await accountRoute(request,env,ctx,begin,execution),ctx.budget,begin);
  if(!path.startsWith('/v10/control/'))fail('v10_route_not_supported');
  const service=new V10ControlService(ctx.store,policy(env,begin));
  if(path==='/v10/control/finish'&&request.method==='POST')return json(await service.finish((await readJson(request,32768)).gatewayReceipt,begin),ctx.budget,begin);
  if(path==='/v10/control/serving'&&request.method==='POST'){
   if(!policy(env,begin).enabled)fail('v10_control_not_ready');
   const body=await readJson(request,32768);return json(await service.serving(body.serviceProof,begin,body.fresh===true),ctx.budget,begin);
  }
  const actor=await authorize(ctx,request,begin);
  if(path==='/v10/control/configuration'&&request.method==='GET')return json(service.configuration(),ctx.budget,begin);
  if(path==='/v10/control/authorize'&&request.method==='POST'){
   if(!ownerAllowed(env,actor.id))fail('v10_account_not_in_test_scope');
   const body=await readJson(request,32768);verifyProcessingIssue(body.serviceProof,body,env,begin);
   return json(await service.issue(actor,body,begin),ctx.budget,begin);
  }
  if(path==='/v10/control/requests/resolve'&&request.method==='POST'){const value=await service.resolve(actor,(await readJson(request,32768)).requestKey,begin);delete value.authorization;return json(value,ctx.budget,begin);}
  if(path==='/v10/control/requests/cancel'&&request.method==='POST')return json(await service.resolve(actor,(await readJson(request,32768)).requestKey,begin,true),ctx.budget,begin);
  if(path==='/v10/control/cancel'&&request.method==='POST')return json(await service.cancel(actor,(await readJson(request,32768)).sessionId,begin),ctx.budget,begin);
  if(request.method==='POST'&&['/v10/control/devices/challenge','/v10/control/devices/register'].includes(path)){
   const p=service.configuration(),body=await readJson(request,32768),registration=new GatewayDeviceRegistration(ctx.store,new AppAttestVerifier({appId:env.DEVICE_APP_ATTEST_APP_ID,environment:env.DEVICE_APP_ATTEST_ENVIRONMENT}),deployment(env));
   return json(path.endsWith('/challenge')?await registration.challenge(actor,body.devicePublicKey,p.planHash,begin):await registration.register(actor,body,p.planHash,begin),ctx.budget,begin);
  }
  fail('v10_route_not_supported');
 }catch(error){const code=String(error?.code??error?.message??'');const safe=/^(v10_|apple_|account_|auth_|d1_|device_|gateway_|release_|public_)[a-z0-9_]+$/.test(code)?code:'v10_control_unavailable';
  const status=/auth_required/.test(safe)?401:/route_not_supported/.test(safe)?404:/not_ready|not_configured|unavailable|unconfirmed|configuration|approval|version_required/.test(safe)?503:409;
  return json({error:{code:safe,message:'Account/control operation was not completed'}},ctx?.budget,begin,status);
 }
}};
function json(value,budget,begin=Date.now(),status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 ...(budget?{'server-timing':budget.timingHeader(Date.now()-begin),'x-wujie-d1-calls':String(budget.databaseCalls)}:{})}});}
function documents(env,path,head){const set=requirePublicDocuments(env),kind=({'/privacy':'privacy','/terms':'terms','/support':'account','/refund':'account','/account/delete':'account','/providers':'providers','/permissions':'permissions'})[path];
 const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const chosen=kind?set.documents.filter(d=>d.kind===kind):set.documents;
 const html='<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>无界 AI 1.0</title><h1>无界 AI 1.0'+(set.approvalRef?'':' · QA文档草案')+'</h1><p>'+escape(set.legalEntity)+'</p>'+chosen.map(d=>'<h2>'+escape(d.zhTitle)+'</h2>'+d.zhSections.map(s=>'<h3>'+escape(s.title)+'</h3><p>'+escape(s.body)+'</p>').join('')).join('')+'<p>'+escape(set.supportEmail)+'</p></html>';
 return new Response(head?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
}
