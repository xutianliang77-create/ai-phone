import {readJson,onlyKeys,sql,requirePublicDocuments,publicDocumentJson} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash,fail} from './common.mjs';
import {registerDeletionRecovery,recoverDeletionOwner} from './deletion-recovery.mjs';
import {context} from './environment.mjs';
export async function accountRoute(request,env,ctx,config,actor,subscriptions,now,execution){
 const path=new URL(request.url).pathname,authorization=request.headers.get('authorization')??undefined;
 if(path==='/auth/apple/request'||path==='/auth/apple/login'){
  if(request.method!=='POST')fail('v10_method_not_allowed',405);requirePublicDocuments(env);
  const body=await readJson(request,65536);if(body.deploymentId!==config.deploymentId)fail('v10_deployment_binding');
  if(path.endsWith('/request')){onlyKeys(body,['deploymentId','action']);if(body.action!=='login')fail('v10_login_action');return {ok:true,...await ctx.account.beginSignIn(now),deploymentId:config.deploymentId,privacyVersion:env.PRIVACY_VERSION,termsVersion:env.TERMS_VERSION,documentSetHash:hash(publicDocumentJson(env))};}
  onlyKeys(body,['deploymentId','challengeId','state','bindingSecret','identityToken','authorizationCode','agreements']);const result=await ctx.account.completeSignIn(body,now);
  return {ok:true,token:result.bearerToken,expiresAt:result.expiresAt,account:{...result.account,phoneMasked:''},deploymentId:config.deploymentId};
 }
 if(path==='/auth/logout'&&request.method==='POST'){await ctx.account.logout(authorization,now);return {status:'ok'};}
 if(!actor)fail('v10_auth_required',401);
 if(path==='/account/me'&&request.method==='GET')return {account:{...actor.account,phoneMasked:''}};
 if(path==='/account/delete'&&request.method==='POST'){
  const b=await readJson(request,8192);onlyKeys(b,['receiptHash']);
  await registerDeletionRecovery(ctx,actor,now,b.receiptHash);
  const result=await ctx.account.requestDeletion(authorization,now);
  if(execution)execution.waitUntil(context(env,true).then(recovery=>recoverDeletionOwner(recovery,actor.id,now)));
  return {account:{...result.account,phoneMasked:''},deletion:{status:'requested',localContentDeletion:'device_user_controlled'}};
 }
 await ctx.surface.ready();
 if(path==='/account/consents'&&request.method==='GET')return ctx.surface.consents(actor);
 if(path==='/account/consents'&&request.method==='POST'){const b=await readJson(request,8192);onlyKeys(b,['consentType','version','scene','acceptedAt','source','locale']);return ctx.surface.recordConsent(actor,b,now,request.headers.get('idempotency-key')??undefined);}
 if(path==='/account/export'&&request.method==='GET')return {exportedAt:new Date(now).toISOString(),account:{...actor.account,phoneMasked:''},...await ctx.surface.consents(actor),subscription:await subscriptions.entitlement(actor.id,now),billingLedger:(await subscriptions.ledger(actor.id)).ledger,sessions:[],termbaseTerms:[],agentCalls:[],contentLocation:'device',privateDataExportRequired:false};
 fail('v10_route_not_supported',404);
}

export async function deletionStatus(ctx,authorization,now){
 const secret=/^DeletionReceipt ([A-Za-z0-9_-]{43})$/.exec(authorization??'')?.[1];
 if(!secret)fail('v10_deletion_status_not_found',404);
 const row=await ctx.store.read(sql(`SELECT c.completed_ms,c.apple_revocation,j.state,h.reason,a.status account_status
  FROM v10_deletion_status_capabilities c LEFT JOIN v10_account_deletion_recovery j ON j.owner_id=c.owner_id
  LEFT JOIN v10_account_deletion_holds h ON h.owner_id=c.owner_id
  JOIN accounts a ON a.user_id=c.owner_id
  WHERE c.capability_hash=? AND c.expires_ms>?`,hash('v10-deletion:'+secret),now));
 if(!row)fail('v10_deletion_status_not_found',404);
 if(row.completed_ms!==null)return {status:'completed',appleRevocation:row.apple_revocation,completedAtMs:row.completed_ms};
 if(row.account_status==='active')return {status:'not_submitted'};
 if(row.reason)return {status:'review_required'};
 return {status:'processing'};
}

export async function deletionAcknowledgement(ctx,authorization,now){
 const token=/^Bearer ([^\s]+)$/.exec(authorization??'')?.[1];if(!token||token.length>4096)return null;
 const completed=await ctx.store.read(sql('SELECT tombstone_id,apple_revocation,completed_ms FROM v10_account_deletion_receipts WHERE token_hash=? AND expires_ms>?',hash('auth-token:'+token),now));
 if(completed)return {account:{id:completed.tombstone_id,status:'deleted',createdAt:new Date(completed.completed_ms).toISOString(),phoneMasked:''},
  deletion:{status:'completed',appleRevocation:completed.apple_revocation,localContentDeletion:'device_user_controlled'},replayed:true};
 const row=await ctx.store.read(sql("SELECT a.user_id,a.status,a.created_ms FROM account_tokens t JOIN accounts a ON a.user_id=t.user_id WHERE t.token_hash=? AND t.expires_ms>? AND a.status IN('deletion_requested','deleted')",hash('auth-token:'+token),now));
 if(!row)return null;
 return {account:{id:row.user_id,status:row.status,createdAt:new Date(row.created_ms).toISOString(),phoneMasked:''},deletion:{status:'requested',localContentDeletion:'device_user_controlled'},replayed:true};
}
