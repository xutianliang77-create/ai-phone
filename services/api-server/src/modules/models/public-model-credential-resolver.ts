import type {ModelComponent,Credentials} from "./public-model-config.js";
import {PublicConfigError} from "./public-model-config.js";
import {selectCurrentPublicModelConfiguration,type PublicModelRuntimeSnapshot} from "./public-model-runtime-config.js";
import {resultSyncHash} from "../sessions/session-result-sync-contract.js";
import {readPublicGoogleAdc,exchangeGoogleToken,googleAuthWait,googleAuthError,type GoogleAccessToken} from "./google-token-exchange.js";

/** One resolver per bound component snapshot. Never persists tokens or discovers
 * ambient accounts. Only the original factory's server-side callback consumes it. */
export function createPublicModelCredentialResolver(value:PublicModelRuntimeSnapshot,component:ModelComponent,
  options:{fetchFn?:typeof fetch;now?:()=>number}={}){
  const snapshot=structuredClone(value),profile=snapshot.components[component];
  if(!profile)throw new PublicConfigError("public_runtime_component_disabled",409);
  const now=options.now??Date.now,fetchFn=options.fetchFn??fetch;
  let pinnedFingerprint:string|undefined,cached:GoogleAccessToken|undefined;
  let flight:{controller:AbortController;promise:Promise<GoogleAccessToken>;waiters:number}|undefined;
  const load=()=>selectCurrentPublicModelConfiguration(snapshot,config=>{
    const credentials=config.credentials[component];
    if(profile.vendor!=="google"||!["google_service_account","google_adc"].includes(profile.authKind))return {credentials:structuredClone(credentials)};
    const raw=profile.authKind==="google_adc"?readPublicGoogleAdc():credentials.serviceAccountJson;
    if(!raw)throw googleAuthError("credential_required");
    const fingerprint=resultSyncHash({snapshot,component,raw});
    if(pinnedFingerprint!==undefined&&pinnedFingerprint!==fingerprint){cached=undefined;throw googleAuthError("credentials_changed");}
    pinnedFingerprint=fingerprint;return {raw};
  });
  const fresh=(token:GoogleAccessToken)=>Number.isFinite(now())&&token.accessTokenExpiresAt>now()+profile.timeoutMs+30000;
  return async(signal?:AbortSignal):Promise<Credentials&Partial<GoogleAccessToken>>=>{
    if(signal?.aborted)throw googleAuthError("cancelled");
    const source=load();if("credentials"in source)return source.credentials!;
    if(cached&&fresh(cached))return {...cached};
    if(!flight){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(profile.timeoutMs,10000));
      const next={controller,waiters:0,promise:undefined as unknown as Promise<GoogleAccessToken>};
      next.promise=exchangeGoogleToken(source.raw!,fetchFn,controller.signal,now).then(token=>{
        load();if(controller.signal.aborted)throw googleAuthError("cancelled");
        if(!fresh(token))throw googleAuthError("token_lifetime_too_short");
        cached={...token};return token;
      }).finally(()=>{clearTimeout(timer);if(flight===next)flight=undefined;});
      flight=next;
    }
    const owned=flight;owned.waiters++;
    try{const token=await googleAuthWait(owned.promise,signal??new AbortController().signal);load();return {...token};}
    finally{owned.waiters--;if(owned.waiters===0&&flight===owned){owned.controller.abort();flight=undefined;}}
  };
}
