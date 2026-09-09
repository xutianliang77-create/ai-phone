import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { ProviderRouter } from "../providers/provider-router.js";
import { GatewayDependencyReadinessMonitor } from "./gateway-dependency-readiness.js";
import { gatewayHealthPayload, gatewayReleaseReadinessPayload } from "./gateway-health.js";
import { admitRealtimeConnection } from "./realtime-connection-admission.js";
import { deleteSession, getSession, activeSessionCount } from "../sessions/session-manager.js";

const secret = "public-admission-test-secret";
const id = "public-admission-test-session";
const claims = () => ({userId:"owner",sessionId:id,sourceLanguage:"zh",targetLanguage:"en",
  voiceOutput:false,planCode:"free",maxDurationSeconds:300,issuedAt:1,
  expiresAt:Math.floor(Date.now()/1000)+60});
function token(value:unknown) {
  const payload=Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`;
}
function connect(value:unknown,publicDeploymentId?:string) {
  const ws={readyState:1,send:vi.fn(),close:vi.fn()};
  const env={realtimeTokenSecret:secret,maxSessions:10,publicDeploymentId} as RealtimeEnv;
  const request={headers:{"sec-websocket-protocol":`ai-phone.realtime.v1,ai-phone.token.${token(value)}`}} as IncomingMessage;
  return {ws,result:admitRealtimeConnection(ws as unknown as WebSocket,request,env)};
}
afterEach(()=>{deleteSession(id);vi.unstubAllEnvs();});
describe("public processing must never attach to the legacy Gateway chain",()=>{
  it("does not treat a runtime-only token as legacy private processing",()=>{
    const value={...claims(),publicRuntime:{deploymentId:"public-test"}};
    const {ws,result}=connect(value);expect(result).toBeNull();expect(getSession(id)).toBeNull();expect(ws.close).toHaveBeenCalled();
    expect(()=>new ProviderRouter().selectProvider(undefined,value as any)).toThrow("public_processing_not_ready");
  });
  it.each([{},null,{contractVersion:1,processingMode:"online"},{contractVersion:2},false])(
    "rejects every unqualified versioned token before state mutation (%j)",processing=>{
      const before=activeSessionCount();
      const {ws,result}=connect({...claims(),processing});
      expect(result).toBeNull();expect(getSession(id)).toBeNull();expect(activeSessionCount()).toBe(before);
      expect(ws.close).toHaveBeenCalled();
      expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({type:"error",code:"provider_unavailable",retryable:false});
    });
  it("refuses legacy tokens on a public deployment",()=>{
    const {result,ws}=connect(claims(),"public-test");
    expect(result).toBeNull();expect(getSession(id)).toBeNull();expect(ws.close).toHaveBeenCalled();
  });
  it("preserves ordinary legacy admission on a private deployment",()=>{
    const {result,ws}=connect(claims());expect(result?.session.id).toBe(id);expect(ws.close).not.toHaveBeenCalled();
  });
  it("loads the same explicit deployment identity as the API without inferring it from region or provider",()=>{
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");expect(loadEnv().publicDeploymentId).toBe("public-test");
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","");expect(loadEnv().publicDeploymentId).toBeUndefined();
  });
  it.each(["mock","hymt2_self_hosted","qwen_live","openai"])(
    "never treats existing %s configuration as qualified public models",async provider=>{
      vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");vi.stubEnv("REALTIME_PROVIDER",provider);
      const env=loadEnv();const fetchFn=vi.fn();
      const readiness=await new GatewayDependencyReadinessMonitor(env,fetchFn).refresh();
      expect(readiness).toMatchObject({sessionReady:false,releaseReady:false,evidence:"implementation_gate"});
      expect(readiness.services.map(s=>s.name)).toEqual(["asr","translation","tts"]);
      expect(readiness.services.every(s=>s.status==="not_ready"&&s.execution==="public")).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(()=>new ProviderRouter().selectProvider(env)).toThrow("public_processing_not_ready");
    });
  it("does not let a legacy ready snapshot or missing probes qualify public health",()=>{
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");const env=loadEnv();
    const old={status:"ready" as const,sessionReady:true,releaseReady:true,checkedAt:"old",issues:[],warnings:[],services:[]};
    for(const deps of [undefined,old]) {
      const health=gatewayHealthPayload(env,undefined,deps);
      expect(health.status).toBe("unavailable");expect(health.legacyProviderIgnored).toBe(true);
      expect(health.asrEndpoint).toBeUndefined();expect(health.translationEndpoint).toBeUndefined();
      expect(gatewayReleaseReadinessPayload(env,undefined,deps).status).toBe("not_ready");
      expect(gatewayReleaseReadinessPayload(env,undefined,deps).issues).not.toContain("Release requires ASR_PROVIDER=http");
    }
  });
  it("defends provider selection even if its caller omitted admission",()=>{
    expect(()=>new ProviderRouter().selectProvider(undefined,{...claims(),processing:{}} as never))
      .toThrow("public_processing_not_ready");
  });
});
