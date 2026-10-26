import {usesSharedControl} from "../shared-control-client.js";
import type {FastifyInstance} from 'fastify';
import {sendError} from '../../../infrastructure/http/errors.js';
import {appleEnabled,readAppleSettings} from './apple-settings.js';
import {appleService,appleTokenHash,type AppleLoginInput} from './apple-service.js';
import {AppleIdentityError} from './apple-identity.js';
export function registerAppleRoutes(app:FastifyInstance){
 if(usesSharedControl())return;
 app.get('/auth/deployment',async(_request,reply)=>{
  if(!appleEnabled())return sendError(reply,503,'apple_signin_not_enabled','Account deployment is not enabled');
  try{const s=readAppleSettings();reply.header('cache-control','no-store');return {deploymentId:s.deploymentId,backend:'self_hosted',bundleId:s.clientId};}
  catch(error){return failure(reply,error);}
 });
 app.post('/auth/apple/request',async(request,reply)=>{
  try{const body=request.body as {deploymentId?:string;action?:string},s=readAppleSettings();
   if(body?.deploymentId!==s.deploymentId||body.action!=='login')throw new AppleIdentityError('apple_deployment_mismatch');
   return await appleService().begin(request.ip);
  }catch(error){return failure(reply,error);}
 });
 app.post('/auth/apple/login',async(request,reply)=>{
  try{return await appleService().login(request.body as AppleLoginInput);}catch(error){return failure(reply,error);}
 });
 app.addHook('preHandler',async(request,reply)=>{
  if(!appleEnabled())return;
  if(request.routeOptions.url?.startsWith('/auth/phone/'))return sendError(reply,503,'phone_login_not_enabled','Use Apple sign in');
  if(request.routeOptions.url==='/account/delete'&&request.headers.authorization?.startsWith('Bearer wj_')){
   try{return reply.send(await appleService().requestDeletion(appleTokenHash(request.headers.authorization.slice(7).trim())));}
   catch(error){return failure(reply,error);}
  }
 });
}
function failure(reply:Parameters<typeof sendError>[0],error:unknown){
 const code=error instanceof AppleIdentityError?error.code:'apple_operation_unconfirmed';
 const status=/rate_limited|capacity/.test(code)?429:/configuration|not_enabled|origin|jwks_unavailable|oauth_uncertain|unconfirmed|pending/.test(code)?503:400;
 return sendError(reply,status,code,'Apple account operation was not completed');
}
