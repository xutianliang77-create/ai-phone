import {createPrivateKey,sign} from "node:crypto";
import {openSync,readFileSync,fstatSync,closeSync,constants} from "node:fs";
import {isAbsolute} from "node:path";
import {PublicConfigError} from "./public-model-config.js";
export const GOOGLE_TOKEN_URL="https://oauth2.googleapis.com/token";
const scope="https://www.googleapis.com/auth/cloud-platform";
export interface GoogleAccessToken {accessToken:string;accessTokenExpiresAt:number;quotaProjectId?:string;}
export const googleAuthError=(code:string)=>new PublicConfigError(`public_google_${code}`,503);
export async function googleAuthWait<T>(task:Promise<T>,signal:AbortSignal):Promise<T>{
  let listener=()=>{};
  const stopped=new Promise<never>((_,reject)=>{listener=()=>reject(googleAuthError("cancelled"));
    if(signal.aborted)listener();else signal.addEventListener("abort",listener,{once:true});});
  try{return await Promise.race([task,stopped]);}finally{signal.removeEventListener("abort",listener);}
}

/** Explicit deployment-owned ADC file only: no home-directory, CLI, metadata,
 * external-account executable or ambient GOOGLE_APPLICATION_CREDENTIALS discovery. */
export function readPublicGoogleAdc(){
  const file=process.env.PUBLIC_GOOGLE_ADC_FILE;
  if(!file||!isAbsolute(file))throw googleAuthError("adc_file_required");
  let fd:number|undefined;
  try{fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=fstatSync(fd);
    if(!info.isFile()||info.size>65536||(info.mode&0o077)!==0)throw Error();
    return readFileSync(fd,"utf8");
  }catch{throw googleAuthError("adc_file_unreadable");}finally{if(fd!==undefined)closeSync(fd);}
}

function tokenRequest(raw:string,now:number){
  const bad=()=>{throw googleAuthError("credential_invalid");};
  let c:Record<string,unknown>;try{c=JSON.parse(raw);}catch{return bad();}
  if(!c||Array.isArray(c)||typeof c!=="object"||raw.length>65536||
    c.token_uri!==undefined&&c.token_uri!==GOOGLE_TOKEN_URL||c.universe_domain!==undefined&&c.universe_domain!=="googleapis.com")return bad();
  const clean=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=16384&&/^[\x21-\x7e]+$/.test(v);
  const quota=c.quota_project_id;
  if(quota!==undefined&&(typeof quota!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(quota)))return bad();
  const body=new URLSearchParams();
  if(c.type==="service_account"){
    if(!clean(c.client_email)||!c.client_email.includes("@")||typeof c.private_key!=="string"||
      c.private_key_id!==undefined&&(!clean(c.private_key_id)||c.private_key_id.length>240))return bad();
    try{
      const key=createPrivateKey(c.private_key);
      if(key.asymmetricKeyType!=="rsa"||(key.asymmetricKeyDetails?.modulusLength??0)<2048)return bad();
      const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
      const unsigned=`${encode({alg:"RS256",typ:"JWT",...(c.private_key_id?{kid:c.private_key_id}:{})})}.${encode({iss:c.client_email,scope,aud:GOOGLE_TOKEN_URL,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600})}`;
      body.set("grant_type","urn:ietf:params:oauth:grant-type:jwt-bearer");body.set("assertion",`${unsigned}.${sign("RSA-SHA256",Buffer.from(unsigned),key).toString("base64url")}`);
    }catch{return bad();}
  }else if(c.type==="authorized_user"){
    if(!clean(c.client_id)||!clean(c.client_secret)||!clean(c.refresh_token)||!quota)return bad();
    body.set("grant_type","refresh_token");body.set("client_id",c.client_id);body.set("client_secret",c.client_secret);body.set("refresh_token",c.refresh_token);
  }else throw googleAuthError("adc_type_not_supported");
  return {body:body.toString(),...(quota?{quotaProjectId:quota as string}:{})};
}

export async function exchangeGoogleToken(raw:string,fetchFn:typeof fetch,signal:AbortSignal,now:()=>number):Promise<GoogleAccessToken>{
  const started=now();if(!Number.isFinite(started)||signal.aborted)throw googleAuthError("cancelled");
  const request=tokenRequest(raw,started);
  try{
    const response=await googleAuthWait(fetchFn(GOOGLE_TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:request.body,redirect:"error",signal}),signal);
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw googleAuthError("token_exchange_rejected");}
    if(!response.body)throw googleAuthError("token_response_invalid");
    const reader=response.body.getReader(),chunks:Buffer[]=[];let bytes=0;
    let b:Record<string,unknown>;
    try{while(true){const part=await googleAuthWait(reader.read(),signal);if(part.done)break;
        bytes+=part.value.byteLength;if(bytes>65536)throw googleAuthError("token_response_invalid");chunks.push(Buffer.from(part.value));}
      b=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    if(!b||Array.isArray(b)||typeof b.access_token!=="string"||b.access_token.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(b.access_token)||
      typeof b.token_type!=="string"||b.token_type.toLowerCase()!=="bearer"||!Number.isSafeInteger(b.expires_in)||Number(b.expires_in)<1||Number(b.expires_in)>3600){
      throw googleAuthError("token_response_invalid");
    }
    return {accessToken:b.access_token,accessTokenExpiresAt:started+Number(b.expires_in)*1000,...(request.quotaProjectId?{quotaProjectId:request.quotaProjectId}:{})};
  }catch(e){if(e instanceof PublicConfigError)throw e;throw googleAuthError(signal.aborted?"cancelled":"token_exchange_failed");}
}
