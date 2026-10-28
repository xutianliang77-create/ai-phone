import {createHash} from 'node:crypto';
import {D1CommandStore,D1QueryBudget,D1AccountsRepository,D1AppleChallengesRepository,D1AccountLifecycleRepository,
 AppleIdentityVerifier,AppleOAuthClient,appleClientSecret,AppleCredentialVault,AppleAccountService,D1HttpSurfaceRepository,sql} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {fail} from './common.mjs';
export const sha=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export function deployment(env){const id=env.PUBLIC_DEPLOYMENT_ID;if(typeof id!=='string'||!/^wujie-v10-device-[a-z0-9-]{1,100}$/.test(id))fail('v10_deployment_not_configured');return id;}
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
 if(!value)fail('v10_auth_required',401);return {kind:'customer',id:value.account.id,authorizationEpoch:value.authorizationEpoch,tokenHash:value.tokenHash,account:value.account};}
