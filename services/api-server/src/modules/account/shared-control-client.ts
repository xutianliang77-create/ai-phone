import {createHash} from 'node:crypto';
import type {AccountRecord} from './account-record.js';

export const sharedControlOrigin='https://www.beelinkdata.com';
export function controlDeployment(){const id=process.env.V10_CONTROL_DEPLOYMENT_ID;if(!id||!/^wujie-v10-[a-z0-9-]{1,100}$/.test(id))throw new SharedControlError('control_deployment_not_configured');return id;}
export function usesSharedControl(){return process.env.V10_CONTROL_AUTHORITY==='cloudflare';}
export class SharedControlError extends Error {
  constructor(readonly code:string,readonly statusCode=503){super(code);}
}
export class SharedControlClient {
  constructor(private readonly fetchFn:typeof fetch=fetch,private readonly timeoutMs=5000){}
  private verifiedUntil=0;
  private pendingIdentity?:Promise<void>;
  async identity(){
    if(this.verifiedUntil>Date.now())return;
    if(this.pendingIdentity)return this.pendingIdentity;
    const run=(async()=>{
      const value=await this.send('/auth/deployment','GET');
      if(value.deploymentId!==controlDeployment()||value.backend!=='cloudflare')throw new SharedControlError('shared_control_identity_mismatch');
      this.verifiedUntil=Date.now()+60000;
    })();this.pendingIdentity=run;
    try{await run;}finally{if(this.pendingIdentity===run)this.pendingIdentity=undefined;}
  }
  async account(authorization:string|undefined):Promise<AccountRecord|null>{
    if(!authorization?.startsWith('Bearer ')||authorization.length>4103)return null;
    await this.identity();
    const value=await this.send('/account/me','GET',undefined,authorization);
    const account=value.account as Record<string,unknown>|undefined;
    if(!account || typeof account.id!=='string' || account.status!=='active')return null;
    const now=new Date().toISOString();
    return {id:account.id,status:'active',phoneHash:'shared-control:'+account.id,phoneMasked:'',createdAt:now,updatedAt:now};
  }
  async request(path:string,method:'GET'|'POST',body?:unknown,authorization?:string){
    if(!path.startsWith('/v10/control/') && !['/usage/balance','/billing/ledger'].includes(path))
      throw new SharedControlError('shared_control_path_forbidden');
    await this.identity();return this.send(path,method,body,authorization);
  }
  private async send(path:string,method:'GET'|'POST',body?:unknown,authorization?:string){
    const deadline=Date.now()+this.timeoutMs;
    try{return await this.sendOnce(path,method,body,authorization,method==='GET'?Math.ceil(this.timeoutMs/2):this.timeoutMs);}
    catch(error){
      if(method!=='GET'||!(error instanceof SharedControlError)||error.code!=='shared_control_unavailable'||Date.now()>=deadline)throw error;
      return this.sendOnce(path,method,body,authorization,Math.max(1,deadline-Date.now()));
    }
  }
  private async sendOnce(path:string,method:'GET'|'POST',body?:unknown,authorization?:string,timeoutMs=this.timeoutMs):Promise<Record<string,unknown>>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await this.fetchFn(sharedControlOrigin+path,{method,redirect:'error',signal:controller.signal,
        headers:{'content-type':'application/json',...(authorization?{authorization}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value=await response.json() as Record<string,unknown>;
      if(!response.ok){const error=value.error as {code?:unknown}|undefined;
        throw new SharedControlError(typeof error?.code==='string'?error.code:'shared_control_request_failed',response.status);}
      return value;
    } catch(error){if(error instanceof SharedControlError)throw error;throw new SharedControlError('shared_control_unavailable');}
    finally{clearTimeout(timer);}
  }
}
let client:SharedControlClient|undefined;
export function sharedControlClient(){return client??=new SharedControlClient();}
export function resetSharedControlClientCache(){client=undefined;}
export function sharedTokenHash(token:string){return createHash('sha256').update('auth-token:'+token).digest('hex');}
