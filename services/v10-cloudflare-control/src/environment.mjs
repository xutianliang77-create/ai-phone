import {createHash} from 'node:crypto';
import {D1CommandStore,D1QueryBudget,D1AccountsRepository,D1AppleChallengesRepository,D1AccountLifecycleRepository,
 AppleIdentityVerifier,AppleOAuthClient,appleClientSecret,AppleCredentialVault,AppleAccountService,D1HttpSurfaceRepository,sql} from '../vendor/reused-control-core.mjs';
import {fail,strongKey} from './protocol.mjs';
export const sha=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export function deployment(env){const id=env.PUBLIC_DEPLOYMENT_ID;if(typeof id!=='string'||!/^wujie-v10-[a-z0-9-]{1,100}$/.test(id))fail('v10_deployment_not_configured');return id;}
const positive=v=>{if(!/^[1-9][0-9]*$/.test(String(v)))fail('v10_writer_not_configured');return Number(v);};
function ring(raw){let value;try{value=JSON.parse(raw);}catch{fail('v10_keyring_not_configured');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([id,key])=>!id||typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key)))fail('v10_keyring_not_configured');
 return new Map(Object.entries(value).map(([id,key])=>[id,Buffer.from(key,'hex')]));}
const verifiers=new Map();
function identityVerifier(env){const key=env.APPLE_TEAM_ID+':'+env.PUBLIC_BUNDLE_ID;let verifier=verifiers.get(key);if(!verifier){if(verifiers.size>=4)verifiers.clear();verifier=new AppleIdentityVerifier(env.PUBLIC_BUNDLE_ID,env.APPLE_TEAM_ID);verifiers.set(key,verifier);}return verifier;}
export async function context(env,withAccount=true){
 const budget=new D1QueryBudget(50),store=new D1CommandStore(env.D1_COMMERCE,positive(env.COMMERCE_WRITER_FENCE),budget,'commerce',positive(env.CF_RECOVERY_EPOCH));
 await store.ready();
 if(!withAccount)return {budget,store,surface:new D1HttpSurfaceRepository(store,deployment(env))};
 const verifier=identityVerifier(env),vault=new AppleCredentialVault(ring(env.APPLE_CREDENTIAL_KEYS),env.APPLE_CREDENTIAL_ACTIVE_KEY,verifier.scope);
 const oauth=new AppleOAuthClient(env.PUBLIC_BUNDLE_ID,async()=>appleClientSecret({teamId:env.APPLE_TEAM_ID,clientId:env.PUBLIC_BUNDLE_ID,keyId:env.APPLE_KEY_ID,privateKeyPem:env.APPLE_PRIVATE_KEY_PEM},Date.now()));
 const lifecycle=new D1AccountLifecycleRepository(store),account=new AppleAccountService(new D1AccountsRepository(store,verifier.scope),new D1AppleChallengesRepository(store,verifier.scope),lifecycle,verifier,oauth,vault,
 {privacyVersion:env.PRIVACY_VERSION,termsVersion:env.TERMS_VERSION,tokenKeyId:env.ACCOUNT_TOKEN_ACTIVE_KEY,tokenKeys:ring(env.ACCOUNT_TOKEN_KEYS)});
 return {budget,store,account,lifecycle,surface:new D1HttpSurfaceRepository(store,deployment(env))};
}
export async function authorize(ctx,request,now){const value=await ctx.account.authorize(request.headers.get('authorization')??undefined,now);
 if(!value)fail('v10_auth_required');return {kind:'customer',id:value.account.id,authorizationEpoch:value.authorizationEpoch,tokenHash:value.tokenHash,account:value.account};}
export function policy(env,now){
 const from=Date.parse(env.V10_SERVICE_WINDOW_STARTS_AT??''),end=Date.parse(env.V10_SERVICE_WINDOW_ENDS_AT??'');
 let open=env.V10_SERVICE_ADMISSION_ENABLED==='true';
 if(env.V10_SERVICE_WINDOW_STARTS_AT!==undefined||env.V10_SERVICE_WINDOW_ENDS_AT!==undefined)open=open&&Number.isFinite(from)&&Number.isFinite(end)&&from<=now&&now<end&&end-from<=3600000;
 else open=open&&/^[a-f0-9]{64}$/.test(env.V10_SOURCE_MANIFEST_SHA256??'')&&env.V10_SOURCE_MANIFEST_SHA256===env.V10_RELEASE_APPROVED_SOURCE_SHA256;
 return {enabled:open,qualifiedBackend:env.V10_PROCESSING_CONTRACT_ENABLED==='true',gatewayContract:'v10-control-proof-v1',deploymentId:deployment(env),
  endpoint:env.V10_PRIVATE_GATEWAY_ENDPOINT,processingApiBaseUrl:env.V10_PROCESSING_API_BASE_URL,maximumSeconds:1800,
  maximumConcurrentSessions:Number(env.V10_MAX_CONCURRENT_SESSIONS??'1'),revision:env.V10_PROCESSING_CONTRACT_HASH,signingSecret:env.V10_GATEWAY_SIGNING_SECRET};
}
export function ownerAllowed(env,id){if(env.V10_SERVICE_WINDOW_STARTS_AT===undefined&&env.V10_SERVICE_WINDOW_ENDS_AT===undefined)return true;
 try{const list=JSON.parse(env.V10_QA_ALLOWED_ACCOUNT_IDS??'[]');return Array.isArray(list)&&list.length<=32&&list.includes(id)&&list.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(x));}catch{return false;}}
export function internal(env,request){return strongKey(env.INTERNAL_API_SECRET)&&request.headers.get('authorization')==='Bearer '+env.INTERNAL_API_SECRET;}
