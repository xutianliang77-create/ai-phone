import {createHash,createHmac} from 'node:crypto';
import {SharedControlError,sharedControlClient,controlDeployment} from '../account/shared-control-client.js';
import {withSessionWriteLock} from '../sessions/session-write-coordinator.js';
import {loadEnv} from '../../config/env.js';
import {createSession,findSession,saveSegments,markSessionFinalized} from '../sessions/sessions-runtime.repository.js';
import {verifyRealtimeToken} from './realtime-token.js';
import {verifyGatewayStopReceipt} from '@translation/platform-security';
import {normalizeMeasuredBillableSeconds} from '../sessions/session-usage-settlement.js';
import {endSession,updateConsumedSeconds} from '../sessions/sessions-runtime.repository.js';
import {saveSharedControlCompletion} from '../sessions/shared-control-completion.js';
import type {SessionRecord} from '../sessions/session-record.js';
import type {SessionSegmentDto,CreateRealtimeSessionRequest} from '@translation/contracts';

export async function createSharedControlSession(ownerId:string|undefined,authorization:string,body:unknown,expected?:CreateRealtimeSessionRequest){
  if(!body||typeof body!=='object')throw new SharedControlError('control_request_proof_required',409);
  const e=body as {clientData?:unknown;deviceSignature?:unknown};
  const domain='wujie.v10-control.issue-from-processing.v1',payload=Buffer.from(JSON.stringify({domain,deploymentId:controlDeployment(),envelopeHash:createHash('sha256').update(JSON.stringify({clientData:e.clientData,deviceSignature:e.deviceSignature})).digest('hex'),issuedAtMs:Date.now()})).toString('base64url');
  const serviceProof=payload+'.'+createHmac('sha256',process.env.INTERNAL_API_SECRET!).update(domain+'\0'+payload).digest('base64url');
  const value=await sharedControlClient().request('/v10/control/authorize','POST',{...e,serviceProof},authorization);
  if(value.contractVersion!==1 || value.execution!=='retained_v10_processing' || ownerId!==undefined&&value.ownerId!==ownerId ||
      value.deploymentId!==controlDeployment() || typeof value.realtimeToken!=='string' || typeof value.sessionId!=='string')
    throw new SharedControlError('shared_control_session_binding');
  const claims=verifyRealtimeToken(value.realtimeToken,loadEnv().realtimeTokenSecret);
  const binding=value.controlBinding as {bindingHash?:string;expiresAtMs?:number}|undefined;
  const control=(claims as unknown as {control?:{bindingHash?:string}}|null)?.control;
  if(!claims || claims.userId!==value.ownerId || claims.sessionId!==value.sessionId || !binding?.bindingHash || control?.bindingHash!==binding.bindingHash ||
      value.endpoint!==loadEnv().realtimeWsEndpoint)
    throw new SharedControlError('shared_control_processing_ticket');
  if(expected && Object.entries(expected).some(([key,value])=>stable(value)!==stable((claims as unknown as Record<string,unknown>)[key])))
    throw new SharedControlError('shared_control_original_options_mismatch');
  await withSessionWriteLock(value.sessionId,async()=>{
  const existing=await findSession(value.sessionId as string);
  if(existing){if(existing.userId!==value.ownerId)throw new SharedControlError('shared_control_session_owner');}
  else await createSession({id:value.sessionId as string,userId:value.ownerId as string,mode:claims.mode??'conversation',status:'created',
    consumedSeconds:0,createdAt:new Date().toISOString(),segments:[],
    billingAuthority:'cloudflare_v10',controlBindingHash:binding.bindingHash});
  });
  return value;
}
function stable(value:unknown):string {return JSON.stringify(value && typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort().map(([k,v])=>[k,JSON.parse(stable(v))])):value)??'null';}
export async function cancelSharedControlSession(session:SessionRecord,authorization:string){
  const result=await sharedControlClient().request('/v10/control/cancel','POST',{sessionId:session.id},authorization);
  if(result.status!=='ended'||result.sessionId!==session.id||result.consumedSeconds!==0)
    throw new SharedControlError('shared_control_cancel_unconfirmed',409);
  await endSession(session.id);await updateConsumedSeconds(session.id,0);await markSessionFinalized(session.id,'finalize:'+session.id);
  return {sessionId:session.id,status:'ended'};
}
export async function checkSharedControlServing(session:SessionRecord,connectionNonce:string,fresh:boolean,previousNonce?:string,previousProviderClosed=false){
  if(!session.controlBindingHash)throw new SharedControlError('shared_control_session_binding');
  const secret=loadEnv().realtimeTokenSecret;
  if(secret.length<32)throw new SharedControlError('shared_control_signing_not_ready');
  const domain='wujie.v10-control.internal.v1',data=Buffer.from(JSON.stringify({domain,sessionId:session.id,
    bindingHash:session.controlBindingHash,deploymentId:controlDeployment(),connectionNonce,...(previousNonce?{previousNonce,previousProviderClosed}:{}),issuedAtMs:Date.now()})).toString('base64url');
  const serviceProof=data+'.'+createHmac('sha256',secret).update(domain+'\0'+data).digest('base64url');
  return sharedControlClient().request('/v10/control/serving','POST',{serviceProof,fresh});
}
export async function completeSharedControlSession(session:SessionRecord,receipt:unknown,segments?:SessionSegmentDto[]){
  const verified=verifyGatewayStopReceipt(receipt,loadEnv().realtimeTokenSecret,{sessionId:session.id,userId:session.userId});
  if(!verified || typeof receipt!=='string')throw new SharedControlError('shared_control_stop_proof_required',409);
  const expectedHash=createHash('sha256').update(receipt).digest('hex');
  const result=await sharedControlClient().request('/v10/control/finish','POST',{gatewayReceipt:receipt});
  if(result.contractVersion!==1 || result.status!=='ended' || result.sessionId!==session.id || result.receiptHash!==expectedHash ||
      result.consumedSeconds!==normalizeMeasuredBillableSeconds(verified.billableSeconds))throw new SharedControlError('shared_control_settlement_binding');
  if(segments)await saveSegments(session.id,segments);
  // Metadata only. Never call the old local wallet/hold settlement path.
  await saveSharedControlCompletion(session.id,result.consumedSeconds as number,receipt);
  return {sessionId:session.id,status:'ended',consumedSeconds:result.consumedSeconds,idempotencyKey:'finalize:'+session.id};
}
