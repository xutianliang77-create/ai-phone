import { createHmac } from "node:crypto";
import { once } from "node:events";
import { get } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWebSocketServer } from "./websocket-server.js";
import { getSession } from "../sessions/session-manager.js";
import { ProviderRouter } from "../providers/provider-router.js";

const secret="public-loopback-test-secret";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("original Gateway public isolation over loopback WebSocket",()=>{
  it.each(["legacy","versioned","malformed"])("refuses %s before selecting a model or creating a session",async kind=>{
    for(const [key,value] of Object.entries({
      API_RESULT_SYNC_DEPLOYMENT_ID:"public-loopback",MODEL_ROUTING_FILE:"",
      REALTIME_BIND_HOST:"127.0.0.1",REALTIME_PORT:"0",REALTIME_TOKEN_SECRET:secret,
      REALTIME_PROVIDER:"mock",ASR_PROVIDER:"mock",SESSION_EVENT_SINK:"noop",
      PUBLIC_RATE_LIMIT_PROVIDER:"memory",REALTIME_ALLOWED_HOSTS:"127.0.0.1",
      REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN:"true",REALTIME_ALLOW_QUERY_TOKEN:"false",
    }))vi.stubEnv(key,value);
    const fetchSpy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Unexpected outbound request"));
    const selectSpy=vi.spyOn(ProviderRouter.prototype,"selectProvider");
    const server=startWebSocketServer();await once(server,"listening");
    const address=server.address();if(!address||typeof address==="string")throw Error("No loopback address");
    const id=`public-loopback-${kind}`;
    const payload=Buffer.from(kind==="malformed"?"{":JSON.stringify({
      userId:"owner",sessionId:id,planCode:"free",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,
      issuedAt:1,expiresAt:Math.floor(Date.now()/1000)+60,maxDurationSeconds:300,
      ...(kind==="versioned"?{processing:{contractVersion:1,processingMode:"online"}}:{}),
    })).toString("base64url");
    const token=`${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`;
    const ws=new WebSocket(`ws://127.0.0.1:${address.port}/realtime`,
      ["ai-phone.realtime.v1",`ai-phone.token.${token}`], {headers:{host:"127.0.0.1"}});
    try {
      const events: Array<Record<string,unknown>>=[];
      ws.on("message",data=>events.push(JSON.parse(data.toString())));
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error("Admission did not close")),2000);
        ws.once("close",()=>{clearTimeout(timer);resolve();});
        ws.once("error",error=>{clearTimeout(timer);reject(error);});
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({type:"error",code:kind==="malformed"?"invalid_token":"provider_unavailable"});
      expect(getSession(id)).toBeNull();expect(selectSpy).not.toHaveBeenCalled();expect(fetchSpy).not.toHaveBeenCalled();
      // Use the actual HTTP health handler too, without using the outbound fetch spy.
      const health=await new Promise<{status:number;body:{status:string}}>((resolve,reject)=>{
        get(`http://127.0.0.1:${address.port}/health/release-ready`,response=>{
          let body="";response.on("data",chunk=>body+=chunk);response.on("end",()=>resolve({status:response.statusCode!,body:JSON.parse(body)}));
        }).on("error",reject);
      });
      expect(health).toMatchObject({status:503,body:{status:"not_ready"}});
    } finally {
      if(ws.readyState!==WebSocket.CLOSED)ws.terminate();
      await new Promise<void>(resolve=>server.close(()=>resolve()));
    }
  });
});
