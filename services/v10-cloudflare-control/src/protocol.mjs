import {createHash, createHmac, createPublicKey, timingSafeEqual, verify} from 'node:crypto';
import {base64, p256Key} from '../vendor/reused-control-core.mjs';
import {validateCreateRealtimeSessionRequest} from '../../api-server/src/modules/realtime/create-session-request.ts';

export const execution = 'retained_v10_processing';
export const issueDomain = 'wujie.v10-control.issue.v1';
export const connectionDomain = 'wujie.v10-control.connection.v1';
export const internalDomain = 'wujie.v10-control.internal.v1';
export const hash = data => createHash('sha256').update(typeof data === 'string' || ArrayBuffer.isView(data) ? data : JSON.stringify(data)).digest('hex');
export function guardedStore(store, addStatements) {
  return new Proxy(store,{get(target,key){
    if(key==='execute')return (c,program)=>target.execute(c,{...program,statements:[...addStatements(c),...program.statements]});
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
}
export function fail(code) { throw Object.assign(new Error(code), {code}); }
export function requireSessionId(id) {
  if (typeof id !== 'string' || !/^v10-[a-f0-9]{64}$/.test(id)) fail('v10_session_scope');
  return id;
}
export function privatePolicy(config) {
  if (!config.enabled || !config.qualifiedBackend || config.gatewayContract !== 'v10-control-proof-v1') fail('v10_control_not_ready');
  if (!config.deploymentId || !strongKey(config.signingSecret)) fail('v10_control_signing_not_ready');
  const url = new URL(config.endpoint);
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash ||
      !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname)) fail('v10_processing_endpoint');
  if (config.maximumSeconds !== 1800 || !Number.isInteger(config.maximumConcurrentSessions) || config.maximumConcurrentSessions<1 || config.maximumConcurrentSessions>10) fail('v10_policy_limits');
  const api=new URL(config.processingApiBaseUrl);
  if(api.protocol!=='https:' || api.username || api.password || api.search || api.hash)fail('v10_processing_api');
  return {execution, endpoint:url.toString(), processingApiBaseUrl:api.toString(), maximumSeconds:1800,
    maximumConcurrentSessions:config.maximumConcurrentSessions, preparationGraceSeconds:60, gatewayContract:config.gatewayContract, revision:config.revision};
}
export function strongKey(key) { return typeof key === 'string' && key.length >= 32 && !/dev-secret|replace-with|changeme/i.test(key); }
export function encodeToken(claims, secret) {
  if (!strongKey(secret)) fail('v10_control_signing_not_ready');
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
}
export function internalProof(body, secret) {
  const data=Buffer.from(JSON.stringify({domain:internalDomain,...body})).toString('base64url');
  return data+'.'+createHmac('sha256',secret).update(internalDomain+'\0'+data).digest('base64url');
}
export function verifyInternal(value, secret, now) {
  if (!strongKey(secret) || typeof value !== 'string' || value.length > 12000) fail('v10_internal_proof');
  const [data,sig,extra]=value.split('.');
  const expected=createHmac('sha256',secret).update(internalDomain+'\0'+data).digest();
  const actual=Buffer.from(sig??'','base64url');
  if (extra || actual.length!==expected.length || !timingSafeEqual(actual,expected)) fail('v10_internal_proof');
  const body=JSON.parse(Buffer.from(data,'base64url').toString());
  if (body.domain!==internalDomain || !Number.isSafeInteger(body.issuedAtMs) || Math.abs(now-body.issuedAtMs)>30000 ||
      typeof body.connectionNonce!=='string' || !/^[a-f0-9]{64}$/.test(body.connectionNonce)) fail('v10_internal_binding');
  requireSessionId(body.sessionId); return body;
}
export function verifyIssueEnvelope(envelope, actor, deployment, expectedPlan) {
  if (!envelope || typeof envelope.clientData!=='string') fail('v10_request_proof');
  const bytes=base64(envelope.clientData,16384), body=JSON.parse(bytes.toString('utf8'));
  const fields=['domain','requestKey','deploymentId','ownerId','devicePublicKey','planHash','mode','sourceLanguage','targetLanguage','voiceOutput','issuedAtMs'];
  const hasOptions=body&&Object.hasOwn(body,'options');if(hasOptions)fields.push('options');
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==fields.length || !fields.every(k=>k in body) ||
      body.domain!==issueDomain || body.ownerId!==actor.id || body.deploymentId!==deployment || body.planHash!==expectedPlan ||
      !/^[a-f0-9]{64}$/.test(body.requestKey) || !['conversation','meeting','classroom','business'].includes(body.mode) ||
      !['auto','zh','en'].includes(body.sourceLanguage) || !['zh','en'].includes(body.targetLanguage) ||
      body.sourceLanguage===body.targetLanguage || typeof body.voiceOutput!=='boolean' || !Number.isSafeInteger(body.issuedAtMs)) fail('v10_request_binding');
  const raw=base64(body.devicePublicKey,65);
  if (!verify('sha256',bytes,{key:p256Key(raw).export({type:'spki',format:'pem'}),dsaEncoding:'ieee-p1363'},base64(envelope.deviceSignature,64))) fail('v10_request_signature');
  const options=validateCreateRealtimeSessionRequest(hasOptions?body.options:{mode:body.mode,sourceLanguage:body.sourceLanguage,targetLanguage:body.targetLanguage,voiceOutput:body.voiceOutput});
  if(!options.ok || options.value.mode!==body.mode || options.value.sourceLanguage!==body.sourceLanguage ||
      options.value.targetLanguage!==body.targetLanguage || options.value.voiceOutput!==body.voiceOutput ||
      options.value.voice && options.value.voice.mode!=='preset')fail('v10_original_options_binding');
  return {body, options:options.value, deviceKeyHash:hash(raw), dataHash:hash(bytes)};
}
