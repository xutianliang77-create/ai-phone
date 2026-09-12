import {beforeEach,afterEach,it,expect,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../../app.js";
import * as storage from "../../infrastructure/storage/json-store.js";
import {createUsageHold,consumeSeconds} from "../usage/usage.service.js";
import {observePublicRuntime,publicRecoveryStatus} from "../sessions/public-session-runtime.service.js";
import {serverFinalizationRequest} from "../sessions/public-session-finalization.service.js";
import {completeSessionWithUsage} from "../sessions/session-completion.js";
import {recoverStaleRealtimeSessions} from "../sessions/stale-session-recovery.js";
import {resultSyncHash} from "../sessions/session-result-sync-contract.js";
import type {SessionRecord} from "../sessions/session-record.js";

const start=Date.parse('2026-09-08T00:00:00Z');
let app:FastifyInstance;
const current=()=>storage.getStoreSnapshot().sessions.find(s=>s.id==='public-s')!;
const state=()=>structuredClone(storage.getStoreSnapshot());
const clock=(seconds:number)=>vi.setSystemTime(start+seconds*1000);
const event=(sequence:number,phase:string)=>({leaseId:'server-lease',captureId:'capture-1',languagePolicyKey:'policy:1',
  sequence,phase,finalRevision:sequence===1?0:4,lastAcceptedSample:sequence===1?0:sequence*16000});
const publish=(sequence:number,phase:string,extra={})=>app.inject({method:'POST',url:'/internal/realtime/sessions/public-s/runtime',
  headers:{authorization:'Bearer internal-test-secret-123'},payload:{...event(sequence,phase),...extra}});
const finalize=(body:unknown)=>app.inject({method:'POST',url:'/realtime/sessions/public-s/finalize',payload:body as object});
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});clock(0);
  vi.stubEnv('API_RESULT_SYNC_DEPLOYMENT_ID','public-test');vi.stubEnv('INTERNAL_API_SECRET','internal-test-secret-123');
  vi.stubEnv('API_TEST_AUTO_ACCOUNT','true');
  const s=storage.getStoreSnapshot();s.sessions=[session()];s.billingLedger=[];s.usageHolds=[];s.usageBalances={};s.usagePlanCodes={};
  createUsageHold('guest-user',120,undefined,{sessionId:'public-s',idempotencyKey:'hold:public-s'});
  app=await buildApp();
});
afterEach(async()=>{await app.close();vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();});

it('uses observed active time, excludes pause, freezes stop and settles exactly once',async()=>{
  expect((await publish(1,'active')).statusCode).toBe(200);
  clock(10);await publish(2,'paused');clock(70);await publish(3,'active');clock(75);
  expect((await publish(4,'stopped')).statusCode).toBe(200);
  expect(current().consumedSeconds).toBe(15);expect(current().publicRuntime!.activeMs).toBe(15000);
  expect(storage.getStoreSnapshot().billingLedger.filter(l=>l.idempotencyKey==='settle:public-s')).toHaveLength(1);
  expect(storage.getStoreSnapshot().usageHolds[0].status).toBe('settled');
  const request=serverFinalizationRequest(current()),saved=state();
  const replies=await Promise.all(Array.from({length:8},()=>finalize(request)));
  expect(replies.every(r=>r.statusCode===200&&r.json().consumedSeconds===15)).toBe(true);
  expect(state()).toEqual(saved);
  clock(10000);expect((await finalize(request)).statusCode).toBe(200);expect(state()).toEqual(saved);
});
it('cannot trust client zero/huge seconds, usage or unconfirmed watermarks',async()=>{
  await publish(1,'active');clock(10);await publish(2,'stopped');
  const request=serverFinalizationRequest(current()),before=state();
  for(const body of [{...request,billableSeconds:0},{...request,billableSeconds:999999},
    {...request,providerUsage:{seconds:0}},{...request,segments:[]}])expect((await finalize(body)).statusCode).toBe(400);
  expect((await finalize({...request,stopWatermark:{...request.stopWatermark,lastAcceptedSample:1}})).statusCode).toBe(409);
  expect(state()).toEqual(before);
});
it('missing or gapped runtime evidence cannot become a zero settlement',async()=>{
  const request={operation:'finalize',contractVersion:1,deploymentId:'public-test',modelPolicyRevision:'policy-v1',
    sessionId:'public-s',idempotencyKey:'finalize:public-s',stopWatermark:{captureId:'capture-1',languagePolicyKey:'policy:1',finalRevision:0,lastAcceptedSample:0}};
  expect((await finalize(request)).statusCode).toBe(503);
  await publish(1,'active');clock(61);expect((await publish(2,'stopped')).statusCode).toBe(503);
  expect(current().publicRuntime!.uncertain).toBe(true);
  const saved=state();clock(100);expect((await publish(2,'stopped')).statusCode).toBe(503);
  expect(state()).toEqual(saved);expect(storage.getStoreSnapshot().billingLedger).toEqual([]);
});
it('rejects runtime events without internal authority or with wrong lease/sequence',async()=>{
  const unauth=await app.inject({method:'POST',url:'/internal/realtime/sessions/public-s/runtime',payload:event(1,'active')});
  expect(unauth.statusCode).toBe(401);
  expect((await publish(1,'active',{leaseId:'wrong'})).statusCode).toBe(403);
  expect((await publish(1,'active',{billableSeconds:0})).statusCode).toBe(400);
  expect((await publish(1,'active',{lastAcceptedSample:100})).statusCode).toBe(409);
  await publish(1,'active');const before=state();clock(2);await publish(1,'active');expect(state()).toEqual(before);
  expect((await publish(3,'active')).statusCode).toBe(409);
});
it('recovery reads and duplicate events never extend the disconnect window or create sessions',async()=>{
  await publish(1,'active');clock(10);await publish(2,'disconnected');const until=current().publicRuntime!.recoveryUntil;
  clock(100);expect((await publicRecoveryStatus('public-s','guest-user')).canResume).toBe(true);
  await publish(3,'disconnected');expect(current().publicRuntime!.recoveryUntil).toBe(until);
  const before=state();clock(311);
  const recovery=await publicRecoveryStatus('public-s','guest-user');expect(recovery.canResume).toBe(false);
  expect((await publish(4,'active')).statusCode).toBe(409);expect(state()).toEqual(before);
  expect(storage.getStoreSnapshot().sessions).toHaveLength(1);
});
it('cannot renew a disconnected recovery window through intermediate paused observations',async()=>{
  await publish(1,'active');clock(10);await publish(2,'disconnected');const until=current().publicRuntime!.recoveryUntil;
  clock(100);await publish(3,'paused');expect(current().publicRuntime!.recoveryUntil).toBe(until);
  clock(200);await publish(4,'disconnected');expect(current().publicRuntime!.recoveryUntil).toBe(until);
  clock(311);await publish(5,'paused');const before=state();
  expect((await publish(6,'active')).statusCode).toBe(409);expect(state()).toEqual(before);
});
it('persists one recovery owner only for the exact current disconnected watermark',async()=>{
  await publish(1,'active');clock(10);await publish(2,'disconnected');
  const claim=(ownerId='gateway-owner-a',runtimeSequence=2)=>app.inject({method:'POST',
    url:'/internal/realtime/sessions/public-s/recovery-ownership',headers:{authorization:'Bearer internal-test-secret-123'},payload:{ownerId,runtimeSequence}});
  const first=await claim();expect(first.statusCode).toBe(200);expect(first.json()).toMatchObject({sessionId:'public-s',ownerId:'gateway-owner-a',runtimeSequence:2,
    expiresAt:current().publicRuntime!.recoveryUntil});
  const saved=state();expect((await claim()).json()).toEqual(first.json());expect(state()).toEqual(saved);
  expect((await claim('gateway-owner-b')).statusCode).toBe(409);expect((await claim('gateway-owner-a',3)).statusCode).toBe(409);
  expect(current().publicRecoveryOwnership).toMatchObject({ownerId:'gateway-owner-a',runtimeSequence:2});
});
it('clears a recovery owner when the durable runtime watermark advances',async()=>{
  await publish(1,'active');clock(10);await publish(2,'disconnected');
  const headers={authorization:'Bearer internal-test-secret-123'};
  await app.inject({method:'POST',url:'/internal/realtime/sessions/public-s/recovery-ownership',headers,payload:{ownerId:'gateway-owner-a',runtimeSequence:2}});
  expect(current().publicRecoveryOwnership).toBeDefined();
  await publish(3,'paused');expect(current().publicRecoveryOwnership).toBeUndefined();
});
it('fails closed when a recovery ownership claim is unauthenticated, premature, or expired',async()=>{
  const claim=(body:unknown,headers?:Record<string,string>)=>app.inject({method:'POST',url:'/internal/realtime/sessions/public-s/recovery-ownership',headers,payload:body as object});
  expect((await claim({ownerId:'gateway-owner-a',runtimeSequence:1})).statusCode).toBe(401);
  expect((await claim({ownerId:'gateway-owner-a',runtimeSequence:1},{authorization:'Bearer internal-test-secret-123'})).statusCode).toBe(409);
  expect((await claim({ownerId:1,runtimeSequence:1},{authorization:'Bearer internal-test-secret-123'})).statusCode).toBe(400);
  await publish(1,'active');clock(10);await publish(2,'disconnected');clock(311);
  expect((await claim({ownerId:'gateway-owner-a',runtimeSequence:2},{authorization:'Bearer internal-test-secret-123'})).statusCode).toBe(409);
  expect(current().publicRecoveryOwnership).toBeUndefined();
});
it('rejects cross-account/deployment finalization and deleted-session resurrection',async()=>{
  await publish(1,'active');clock(12);await observePublicRuntime('public-s',event(2,'stopped'));
  const request=serverFinalizationRequest(current()),before=state();
  expect((await finalize({...request,deploymentId:'private-old'})).statusCode).toBe(403);
  current().userId='different';expect((await finalize(request)).statusCode).toBe(403);
  current().userId='guest-user';expect(state()).toEqual(before);
  storage.getStoreSnapshot().sessions=[];expect((await finalize(request)).statusCode).toBe(404);
});
it('atomically rolls back ledger, hold, ended state and receipt on persistence failure',async()=>{
  await publish(1,'active');clock(12);await observePublicRuntime('public-s',event(2,'stopped'));
  const request=serverFinalizationRequest(current()),before=state();
  vi.spyOn(storage,'persistStoreSnapshot').mockImplementationOnce(()=>{throw new Error('injected persistence fault');});
  expect((await finalize(request)).statusCode).toBe(500);expect(state()).toEqual(before);
  expect((await finalize(request)).statusCode).toBe(200);
  expect(storage.getStoreSnapshot().billingLedger.filter(l=>l.idempotencyKey==='settle:public-s')).toHaveLength(1);
});
it('cannot relabel an existing unmatched settlement as a verified public receipt',async()=>{
  await publish(1,'active');clock(12);await observePublicRuntime('public-s',event(2,'stopped'));
  consumeSeconds('guest-user',5,undefined,{sessionId:'public-s',idempotencyKey:'settle:public-s'});
  const before=state();expect((await finalize(serverFinalizationRequest(current()))).statusCode).toBe(409);
  expect(state()).toEqual(before);
});
it('late text receipts require the frozen accepted segment and never change settlement',async()=>{
  await publish(1,'active');clock(8);await publish(2,'stopped');
  const segment=current().segments[0];
  current().processingAuthorization!.syncPermission={allowed:true,scopeId:'scope'};
  current().resultSyncState={grant:{scopeId:'scope',deploymentId:'public-test',ownerId:'guest-user',modelPolicyRevision:'policy-v1',
    consentVersion:'result-text-sync-v2',grantedAt:new Date(start).toISOString(),expiresAt:new Date(start+3600000).toISOString()},receipts:[],revisions:{}};
  const payload=(s=segment,op='tail')=>({operation:'sync',sync:{contractVersion:1,deploymentId:'public-test',scopeId:'scope',modelPolicyRevision:'policy-v1',opId:op,
    revisions:[{segmentId:s.id,revision:s.revision,contentHash:resultSyncHash(s)}]},segments:[s]});
  const ledger=structuredClone(storage.getStoreSnapshot().billingLedger);
  expect((await app.inject({method:'POST',url:'/sessions/public-s/segments',payload:payload()})).statusCode).toBe(200);
  expect((await app.inject({method:'POST',url:'/sessions/public-s/segments',payload:payload({...segment,id:'new'},'other')})).statusCode).toBe(409);
  clock(309);expect((await app.inject({method:'POST',url:'/sessions/public-s/segments',payload:payload(segment,'expired')})).statusCode).toBe(409);
  expect(storage.getStoreSnapshot().billingLedger).toEqual(ledger);
});
it('legacy completion and stale recovery cannot bypass missing public evidence',async()=>{
  await expect(completeSessionWithUsage('public-s',{billableSeconds:0})).rejects.toThrow('verified runtime');
  clock(400);await recoverStaleRealtimeSessions();expect(current().status).toBe('active');
  expect(storage.getStoreSnapshot().usageHolds[0].status).toBe('active');
  expect((await app.inject({method:'POST',url:'/internal/realtime/sessions/public-s/end',headers:{authorization:'Bearer internal-test-secret-123'},payload:{billableSeconds:0}})).statusCode).toBe(503);
});
function session():SessionRecord{return {id:'public-s',userId:'guest-user',mode:'conversation',status:'active',consumedSeconds:0,
  createdAt:new Date(start).toISOString(),lastActivityAt:new Date(start).toISOString(),version:1,
  segments:[{id:'seg',revision:4,sourceText:'你好',translatedText:'Hello',sourceLanguage:'zh',targetLanguage:'en'}],
  processingDeploymentId:'public-test',processingAuthorization:{contractVersion:1,processingMode:'online',modelPolicyRevision:'policy-v1',
    languagePolicy:{source:'zh',target:'en',autoReverse:false,revision:1},syncPermission:{allowed:false},executionPlan:{
      asr:{execution:'public',scopeKey:'asr',reason:'online_selected'},translation:{execution:'public',scopeKey:'mt',reason:'online_selected'},tts:{execution:'disabled'}}},
  publicRuntimePolicy:{leaseId:'server-lease',captureId:'capture-1',languagePolicyKey:'policy:1',expiresAt:new Date(start+3600000).toISOString(),maxActiveSeconds:120}};}
