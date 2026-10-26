import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {buildApp} from '../../../app.js';
import {getStoreSnapshot,createEmptyStoreSnapshot} from '../../../infrastructure/storage/json-store.js';
import {signGatewayStopReceipt} from '@translation/platform-security';
import {resetAppleService} from './apple-service.js';
import {getAccountDeploymentReadiness} from '../account-readiness.js';
const deployment='synthetic-v10-selfhosted',bundle='cn.qkxy.wujieai.public',now=Date.parse('2026-10-26T00:00:00Z');
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),client=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const gatewaySecret='fixture-gateway-secret-do-not-use-in-production';
describe('production HTTP path: Apple account to original realtime lifecycle and unique ledger',()=>{
 let app:Awaited<ReturnType<typeof buildApp>>,lastJwt:string,kid:string,fetchCalls:string[];
 beforeEach(async()=>{
  Object.assign(getStoreSnapshot(),createEmptyStoreSnapshot());vi.spyOn(Date,'now').mockReturnValue(now);resetAppleService();fetchCalls=[];kid=randomUUID();lastJwt='';
  for(const [key,value]of Object.entries({AUTH_PROVIDER:'apple',V10_SERVICE_ADMISSION_ENABLED:'true',V10_SERVICE_WINDOW_STARTS_AT:new Date(now-1000).toISOString(),V10_SERVICE_WINDOW_ENDS_AT:new Date(now+60000).toISOString(),API_PUBLIC_ORIGIN:'https://www.beelinkdata.com',ACCOUNT_DEPLOYMENT_ID:deployment,
   APPLE_CLIENT_ID:bundle,APPLE_TEAM_ID:'5YR3BKMQ62',APPLE_KEY_ID:'FIXTURE123',APPLE_PRIVATE_KEY_PEM:client.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
   APPLE_ACCOUNT_TOKEN_SECRET:'fixture-account-secret-never-a-live-credential',APPLE_CREDENTIAL_ENCRYPTION_KEY:'ab'.repeat(32),PRIVACY_POLICY_VERSION:'fixture-privacy',TERMS_VERSION:'fixture-terms',
   REALTIME_TOKEN_SECRET:gatewaySecret,INTERNAL_API_SECRET:'fixture-internal-api-secret-32-bytes',API_TEST_AUTO_ACCOUNT:'false',DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL:'app_store'}))vi.stubEnv(key,value);
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
   const value=String(url);fetchCalls.push(value);
   if(value==='https://appleid.apple.com/auth/keys')return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid,use:'sig',alg:'RS256'}]});
   if(value==='https://appleid.apple.com/auth/token')return Response.json({id_token:lastJwt,refresh_token:'synthetic-refresh-only'});
   if(value==='https://appleid.apple.com/auth/revoke')return new Response('',{status:200});
   throw Error('offline fixture rejects unknown fetch destination');
  }));
  app=await buildApp();
 });
 afterEach(async()=>{await app?.close();resetAppleService();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
 async function login(sub='synthetic-owner'){
  const challenge=await app.inject({method:'POST',url:'/auth/apple/request',payload:{deploymentId:deployment,action:'login'}});expect(challenge.statusCode).toBe(200);
  const c=challenge.json(),h=Buffer.from(JSON.stringify({alg:'RS256',kid})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'https://appleid.apple.com',aud:bundle,sub,nonce:c.nonce,iat:now/1000,exp:now/1000+300})).toString('base64url');
  lastJwt=h+'.'+b+'.'+sign('sha256',Buffer.from(h+'.'+b),keys.privateKey).toString('base64url');
  const result=await app.inject({method:'POST',url:'/auth/apple/login',payload:{...c,identityToken:lastJwt,authorizationCode:'synthetic-one-use-code',
   agreements:{privacyAccepted:true,termsAccepted:true,privacyVersion:'fixture-privacy',termsVersion:'fixture-terms'}}});
  expect(result.statusCode).toBe(200);const value=result.json();
  const ids=JSON.parse(process.env.V10_QA_ALLOWED_ACCOUNT_IDS??'[]');vi.stubEnv('V10_QA_ALLOWED_ACCOUNT_IDS',JSON.stringify([...ids,value.account.id]));return value;
 }
 const options={mode:'conversation',sourceLanguage:'zh',targetLanguage:'en',voiceOutput:false};
 const create=(token:string,key='a'.repeat(64),body=options)=>app.inject({method:'POST',url:'/realtime/sessions',headers:{authorization:'Bearer '+token,'idempotency-key':key},payload:body});
 it('serves the new deployment identity and keeps legacy phone login disabled',async()=>{
  const r=await app.inject('/auth/deployment');expect(r.json()).toEqual({deploymentId:deployment,backend:'self_hosted',bundleId:bundle});
  expect((await app.inject({method:'POST',url:'/auth/phone/login',payload:{phone:'13800138000',code:'123456'}})).statusCode).toBe(503);
  expect((await create('missing')).statusCode).toBe(401);expect(fetchCalls).toHaveLength(0);
 });
 it('keeps model admission closed by default and after window expiry before any wallet reservation',async()=>{
  const u=await login();vi.stubEnv('V10_SERVICE_ADMISSION_ENABLED','false');expect((await create(u.token)).json().error.code).toBe('service_admission_closed');
  vi.stubEnv('V10_SERVICE_ADMISSION_ENABLED','true');vi.stubEnv('V10_SERVICE_WINDOW_ENDS_AT',new Date(now).toISOString());
  expect((await create(u.token)).statusCode).toBe(503);expect(getStoreSnapshot().usageHolds).toHaveLength(0);expect(getStoreSnapshot().usageBalances).toEqual({});
 });
 it('reuses the exact original session response and one hold after parallel/repeated creation',async()=>{
  const u=await login(),results=await Promise.all([create(u.token),create(u.token),create(u.token)]);expect(results.every(r=>r.statusCode===200)).toBe(true);
  expect(results[1].json()).toEqual(results[0].json());expect(results[2].json()).toEqual(results[0].json());
  expect(getStoreSnapshot().sessions).toHaveLength(1);expect(getStoreSnapshot().usageHolds).toHaveLength(1);expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  const wrong=await create(u.token,'a'.repeat(64),{...options,sourceLanguage:'en',targetLanguage:'zh'});expect(wrong.statusCode).toBe(409);
  expect(fetchCalls.every(u=>u.startsWith('https://appleid.apple.com/'))).toBe(true);
 });
 it('safely cancels only the never-admitted request, then refuses its reactivation',async()=>{
  const u=await login(),r=await create(u.token),sid=r.json().sessionId;
  const stop=await app.inject({method:'POST',url:`/realtime/sessions/${sid}/end`,headers:{authorization:'Bearer '+u.token}});expect(stop.statusCode).toBe(200);
  expect(stop.json().status).toBe('ended');expect(getStoreSnapshot().usageHolds[0].status).not.toBe('active');
  expect((await create(u.token)).json().error.code).toBe('creation_session_terminal');expect(getStoreSnapshot().billingLedger).toHaveLength(0);
 });
 it('requires signed stopping after admission and settles one measured amount despite concurrent receipts',async()=>{
  const u=await login(),r=await create(u.token),sid=r.json().sessionId;
  const internal={authorization:'Bearer fixture-internal-api-secret-32-bytes'};
  expect((await app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/state`,headers:internal,payload:{status:'active',fresh:true}})).statusCode).toBe(200);
  expect((await app.inject({method:'POST',url:`/realtime/sessions/${sid}/end`,headers:{authorization:'Bearer '+u.token}})).statusCode).toBe(409);
  const proof=signGatewayStopReceipt({sessionId:sid,userId:u.account.id,billableSeconds:12,providerClosed:true,issuedAt:now},gatewaySecret);
  const publicStop=()=>app.inject({method:'POST',url:`/realtime/sessions/${sid}/finalize`,headers:{authorization:'Bearer '+u.token},payload:{sessionId:sid,idempotencyKey:'finalize:'+sid,segments:[],billableSeconds:999,gatewayReceipt:proof}});
  const both=await Promise.all([publicStop(),app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/end`,headers:internal,payload:{billableSeconds:0,gatewayReceipt:proof}})]);
  expect(both.map(x=>x.statusCode)).toEqual([200,200]);expect((await publicStop()).statusCode).toBe(200);
  const usage=getStoreSnapshot().billingLedger.filter(x=>x.idempotencyKey==='settle:'+sid);expect(usage).toHaveLength(1);expect(usage[0].deltaSeconds).toBe(-12);
  expect(getStoreSnapshot().usageHolds[0].status).not.toBe('active');
 });
 it('keeps unknown/forged stops reserved and blocks cross-owner account/history access',async()=>{
  const u=await login(),sid=(await create(u.token)).json().sessionId,other=await login('synthetic-other');
  expect((await app.inject({method:'GET',url:`/realtime/sessions/${sid}/status`,headers:{authorization:'Bearer '+other.token}})).statusCode).toBe(403);
  const start=await app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/state`,headers:{authorization:'Bearer fixture-internal-api-secret-32-bytes'},payload:{status:'active',fresh:true}});expect(start.statusCode).toBe(200);
  const fake=await app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/end`,headers:{authorization:'Bearer fixture-internal-api-secret-32-bytes'},payload:{billableSeconds:0,gatewayReceipt:'fake'}});
  expect(fake.statusCode).toBe(409);expect(getStoreSnapshot().usageHolds[0].status).toBe('active');expect(getStoreSnapshot().billingLedger).toHaveLength(0);
 });
 it('revokes an Apple session on logout and safely cancels a provably never-admitted new request',async()=>{
  const u=await login(),sid=(await create(u.token)).json().sessionId;
  expect((await app.inject({method:'POST',url:'/auth/logout',headers:{authorization:'Bearer '+u.token}})).statusCode).toBe(200);
  expect((await app.inject({method:'GET',url:'/account/me',headers:{authorization:'Bearer '+u.token}})).statusCode).toBe(401);
  const start=await app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/state`,headers:{authorization:'Bearer fixture-internal-api-secret-32-bytes'},payload:{status:'active',fresh:true}});
  expect(start.statusCode).toBe(403);expect(start.json().error.code).toBe('session_never_admitted_closed');expect(getStoreSnapshot().usageHolds[0].status).not.toBe('active');
 });
 it('retains an admitted reservation after logout until an authentic stop is available',async()=>{
  const u=await login(),sid=(await create(u.token)).json().sessionId,internal={authorization:'Bearer fixture-internal-api-secret-32-bytes'};
  expect((await app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/state`,headers:internal,payload:{status:'active',fresh:true}})).statusCode).toBe(200);
  await app.inject({method:'POST',url:'/auth/logout',headers:{authorization:'Bearer '+u.token}});
  const start=await app.inject({method:'POST',url:`/internal/realtime/sessions/${sid}/state`,headers:internal,payload:{status:'active',fresh:true}});
  expect(start.statusCode).toBe(403);expect(start.json().error.code).toBe('session_authorization_revoked');expect(getStoreSnapshot().usageHolds[0].status).toBe('active');
 });
 it('validates real signing key shape and rejects weak or missing deployment credentials',()=>{
  vi.stubEnv('NODE_ENV','production');expect(getAccountDeploymentReadiness().otpSecret).toBe('not_required');
  vi.stubEnv('APPLE_PRIVATE_KEY_PEM','invalid');expect(getAccountDeploymentReadiness().issues).toContain('apple_private_key_invalid');
 });
});
