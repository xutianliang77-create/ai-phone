import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createSession,getSession,deleteSession,closedSessionReceipt} from '../sessions/session-manager.js';
import {createSessionEventSink,NeverAdmittedSessionClosed} from '../sessions/session-event-sink.js';
import {recordProviderStartupFailure} from './provider-startup-failure.js';
import {loadEnv} from '../config/env.js';
const key='fixture-realtime-gateway-signing-secret-32';
describe('confirmed never-admitted rejection versus unknown prior execution',()=>{
 let session:ReturnType<typeof createSession>;
 beforeEach(()=>{
  vi.stubEnv('AUTH_PROVIDER','apple');session=createSession({sessionId:'fixture-unadmitted',userId:'fixture-owner',mode:'conversation',sourceLanguage:'zh',targetLanguage:'en',voiceOutput:false,planCode:'free',maxDurationSeconds:300,issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+300});
 });
 afterEach(()=>{if(getSession(session.id)){session.providerCloseConfirmed=true;deleteSession(session.id,session);}vi.unstubAllGlobals();vi.unstubAllEnvs();});
 const sink=()=>createSessionEventSink({...loadEnv(),sessionEventSink:'api',apiBaseUrl:'http://fixture.invalid',internalApiSecret:'fixture-private-internal-api-secret'});
 it('accepts only an owner/session bound authoritative cancellation and releases the unused local slot',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'session_never_admitted_closed',sessionId:session.id,ownerId:session.userId}},{status:403})));
  const error=await sink().touch(session.id,'active',{fresh:true}).catch(e=>e);expect(error).toBeInstanceOf(NeverAdmittedSessionClosed);
  const record=vi.fn(async()=>undefined);
  await recordProviderStartupFailure({session,generation:1,provider:undefined,providerDispatched:false,admissionConfirmed:false,neverAdmittedConfirmed:error instanceof NeverAdmittedSessionClosed,sessionEventSink:{record},secret:key});
  expect(getSession(session.id)).toBeNull();expect(record).toHaveBeenCalledOnce();expect(closedSessionReceipt(session.id,session.userId)?.billableSeconds).toBe(0);
 });
 it('cannot use a cancellation for another owner as proof',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'session_never_admitted_closed',sessionId:session.id,ownerId:'different-owner'}},{status:403})));
  const error=await sink().touch(session.id,'active',{fresh:true}).catch(e=>e);expect(error).not.toBeInstanceOf(NeverAdmittedSessionClosed);
 });
 it('keeps ambiguous allocation/admission outcomes occupied and does not mint a zero stop receipt',async()=>{
  const record=vi.fn(async()=>undefined);
  await recordProviderStartupFailure({session,generation:1,provider:undefined,providerDispatched:false,admissionConfirmed:false,sessionEventSink:{record},secret:key});
  expect(getSession(session.id)).toBe(session);expect(session.providerCloseConfirmed).toBe(false);expect(session.gatewayReceipt).toBeUndefined();expect(record).not.toHaveBeenCalled();
 });
});
