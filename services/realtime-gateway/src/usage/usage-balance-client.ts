import type { RealtimeEnv } from "../config/env.js";
import type { UsageBalanceSnapshot } from "./usage-ticker.js";

export interface UsageBalanceClient {
  getBalance(userId: string): Promise<UsageBalanceSnapshot | null>;
  reserveAllowance?(sessionId:string,targetSeconds:number):Promise<UsageBalanceSnapshot|null>;
}

export function createUsageBalanceClient(env: RealtimeEnv): UsageBalanceClient {
  return new ApiUsageBalanceClient({
    baseUrl: env.apiBaseUrl,
    internalApiSecret: env.internalApiSecret,
    timeoutMs: env.sessionSyncTimeoutMs,
  });
}

class ApiUsageBalanceClient implements UsageBalanceClient {
  constructor(private readonly options: {
    baseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
  }) {}

  async getBalance(userId: string): Promise<UsageBalanceSnapshot | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(
        `${this.normalizedBaseUrl()}/internal/usage/balance/${encodeURIComponent(userId)}`,
        {
          headers: {
            ...(this.options.internalApiSecret
              ? { authorization: `Bearer ${this.options.internalApiSecret}` }
              : {}),
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      const body = await response.json() as {
        availableSeconds?: unknown;
        remainingSeconds?: unknown;
      };
      if (!validSeconds(body.remainingSeconds)||
        body.availableSeconds!==undefined&&!validSeconds(body.availableSeconds)) return null;
      return {
        remainingSeconds: body.remainingSeconds,
        ...(typeof body.availableSeconds === "number"
          ? { availableSeconds: body.availableSeconds }
          : {}),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async reserveAllowance(sessionId:string,targetSeconds:number):Promise<UsageBalanceSnapshot|null>{
    if(!sessionId||!Number.isSafeInteger(targetSeconds)||targetSeconds<1)return null;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.options.timeoutMs);
    try{
      const response=await fetch(
        `${this.normalizedBaseUrl()}/internal/usage/allowance/${encodeURIComponent(sessionId)}`,
        {method:"POST",headers:{"content-type":"application/json",
          ...(this.options.internalApiSecret?{authorization:`Bearer ${this.options.internalApiSecret}`}:{})},
        body:JSON.stringify({targetSeconds}),signal:controller.signal},
      );
      if(!response.ok)return null;
      const body=await response.json() as {status?:unknown;authorizedSeconds?:unknown;
        remainingSeconds?:unknown;availableSeconds?:unknown};
      if(!["held","insufficient"].includes(String(body.status))||
        !validSeconds(body.authorizedSeconds)||body.authorizedSeconds<1||
        !validSeconds(body.remainingSeconds)||!validSeconds(body.availableSeconds))return null;
      return {remainingSeconds:body.remainingSeconds,availableSeconds:body.availableSeconds,
        authorizedSeconds:body.authorizedSeconds};
    }catch{return null;}finally{clearTimeout(timer);}
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/$/, "");
  }
}

function validSeconds(value:unknown):value is number{
  return Number.isSafeInteger(value)&&typeof value==="number"&&value>=0;
}
