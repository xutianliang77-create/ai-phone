import {once} from "node:events";
import type {Server} from "node:http";
import WebSocket from "ws";
import type {FastifyInstance} from "fastify";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {buildApp} from "../../app.js";
import {installConfigurationFixture,current,now,body,evidence} from "../sessions/public-model-configuration.test-support.js";
import {getStoreSnapshot,normalizeStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import {recoverStaleRealtimeSessions} from "../sessions/stale-session-recovery.js";
import * as finalization from "../sessions/public-session-finalization.service.js";
import {savePublicModelConfiguration} from "../models/public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {revokePublicInferenceEvidence} from "../sessions/public-inference-admission.service.js";
import {startWebSocketServer} from "../../../../realtime-gateway/src/connection/websocket-server.js";
import {getSession} from "../../../../realtime-gateway/src/sessions/session-manager.js";
import {ProviderRouter} from "../../../../realtime-gateway/src/providers/provider-router.js";
import {SyntheticAsrSocket} from "../../../../realtime-gateway/src/asr/streaming-asr.test-support.js";
import {SyntheticQwenAsrSocket} from "../../../../realtime-gateway/src/asr/qwen-streaming-asr.test-support.js";
const signer="SYNTHETIC_WEBSOCKET_SIGNER_NOT_REAL",internal="SYNTHETIC_INTERNAL_KEY_NOT_REAL",access="SYNTHETIC_CREDENTIAL_ACCESS_NOT_REAL";
let app:FastifyInstance,server:Server|undefined,ws:WebSocket|undefined;
const messages:any[]=[];
installConfigurationFixture();
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);messages.length=0;
  for(const [key,value]of Object.entries({API_TEST_AUTO_ACCOUNT:"true",REALTIME_TOKEN_SECRET:signer,INTERNAL_API_SECRET:internal,REALTIME_WS_ENDPOINT:"wss://gateway.synthetic.invalid/realtime",
    API_BASE_URL:"https://api.synthetic.invalid",MODEL_ROUTING_FILE:"",REALTIME_BIND_HOST:"127.0.0.1",REALTIME_PORT:"0",REALTIME_PROVIDER:"mock",ASR_PROVIDER:"mock",SESSION_EVENT_SINK:"api",
    PUBLIC_RATE_LIMIT_PROVIDER:"memory",REALTIME_ALLOWED_HOSTS:"127.0.0.1",REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN:"true",REALTIME_ALLOW_QUERY_TOKEN:"false"}))vi.stubEnv(key,value);
  const store=getStoreSnapshot();store.sessions=[];store.usageHolds=[];store.billingLedger=[];store.usageBalances={};store.usagePlanCodes={};
  app=await buildApp({publicGatewayCredentialAccess:{secret:access},publicRealtimeAuthority:{timeoutMs:2000,
    resolveVerifiedEvidence:async()=>({records:evidence(),refs:{consentReceiptId:"consent",budgetReservationId:"budget",
      qualificationReceiptIds:{asr:"asr",translation:"translation",...(current().publicModelConfiguration!.components.tts?{tts:"tts"}:{})}}})}});
});
afterEach(async()=>{
  if(ws&&ws.readyState!==WebSocket.CLOSED){ws.terminate();await once(ws,"close").catch(()=>{});}ws=undefined;
  if(server){await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}
  const sessionId=getStoreSnapshot().sessions[0]?.id;
  if(sessionId)await waitFor(()=>getSession(sessionId)===null);
  await app.close();vi.useRealTimers();
});
async function waitFor(test:()=>boolean,timeout=5000){const until=performance.now()+timeout;while(!test()){if(performance.now()>until)throw Error("Synthetic WebSocket condition timed out: "+messages.map(e=>e.type+":"+(e.code??"")).join(","));await new Promise(r=>setTimeout(r,10));}}
async function setup(vendor="qwen",voice=false,overrideAccess=access,afterApiReply?:(path:string,body:any)=>void){
  const update=body(1);if(vendor==="openai")Object.assign(update.components.asr,{vendor,protocol:"openai_realtime_asr",sampleRate:24000});
  Object.assign(update.components.tts,{vendor:"openai",protocol:"openai_speech",endpoint:"https://model.synthetic.invalid/v1",modelId:"manual-tts",sampleRate:24000,voice:"coral"});
  await savePublicModelConfiguration(update);const configuration=capturePublicModelRuntimeConfiguration(voice);
  const result=await app.inject({method:"POST",url:"/realtime/sessions",headers:{"idempotency-key":"websocket-0001"},payload:{mode:"conversation",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:voice,speakerAttribution:{mode:"off"},
    processing:{contractVersion:1,processingMode:"online",modelPolicyRevision:configuration.modelPolicyRevision,executionPlan:configuration.executionPlan,languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncRequested:false}}});
  expect(result.statusCode).toBe(200);const issued=result.json();
  const calls:Array<{path:string;body:any;headers:any}>=[];
  const apiFetchFn=vi.fn(async(url:any,init:any)=>{const path=new URL(String(url)).pathname,body=JSON.parse(init.body);calls.push({path,body,headers:init.headers});
    const reply=await app.inject({method:"POST",url:path,headers:init.headers,payload:body});afterApiReply?.(path,body);return new Response(reply.body,{status:reply.statusCode});});
  const modelFetchFn=vi.fn(async(url:any)=>String(url).endsWith("/audio/speech")?new Response(Buffer.alloc(4800),{headers:{"content-type":"audio/pcm"}}):new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Today we test public speech translation."}}]})));
  const asrSocketFactory=vi.fn(()=>{const peer=vendor==="qwen"?new SyntheticQwenAsrSocket():new SyntheticAsrSocket();peer.transcript="今天我们测试公共语音翻译。";return peer.asWebSocket();});
  const privateSelect=vi.spyOn(ProviderRouter.prototype,"selectProvider");
  server=startWebSocketServer({publicRuntime:{credentialAccessSecret:overrideAccess,apiFetchFn,modelFetchFn,asrSocketFactory}});await once(server,"listening");
  const address=server.address();if(!address||typeof address==="string")throw Error("No loopback socket");
  ws=new WebSocket(`ws://127.0.0.1:${address.port}/realtime`,["ai-phone.realtime.v1",`ai-phone.token.${issued.realtimeToken}`],{headers:{host:"127.0.0.1"}});
  ws.on("message",data=>messages.push(JSON.parse(data.toString())));await once(ws,"open");
  return {issued,calls,apiFetchFn,modelFetchFn,asrSocketFactory,privateSelect};
}
describe("original Gateway loopback WebSocket with session-scoped API materials",()=>{
  it.each([["qwen",true],["openai",false]] as const)("runs %s ASR, MT, optional TTS=%s, pause/resume and one settlement",async(vendor,voice)=>{
    const s=await setup(vendor,voice);await waitFor(()=>messages.some(e=>e.type==="session.started"));expect(current().status).toBe("active");
    vi.setSystemTime(now.getTime()+1000);
    ws!.send(JSON.stringify({type:"audio.frame",sessionId:s.issued.sessionId,sequence:1,timestampMs:0,format:"pcm16",sampleRate:s.issued.captureSampleRate,data:Buffer.alloc(s.issued.captureSampleRate/5).toString("base64")}));
    ws!.send(JSON.stringify({type:"audio.boundary",sessionId:s.issued.sessionId,sequence:1}));
    await waitFor(()=>messages.some(e=>e.type==="translation.final"));if(voice)await waitFor(()=>messages.some(e=>e.type==="audio.output"));
    ws!.send(JSON.stringify({type:"session.pause",sessionId:s.issued.sessionId}));await waitFor(()=>messages.some(e=>e.type==="session.paused"));
    vi.setSystemTime(now.getTime()+3000);ws!.send(JSON.stringify({type:"session.resume",sessionId:s.issued.sessionId}));await waitFor(()=>messages.some(e=>e.type==="session.resumed"));
    vi.setSystemTime(now.getTime()+4000);ws!.send(JSON.stringify({type:"session.end",sessionId:s.issued.sessionId}));await waitFor(()=>messages.some(e=>e.type==="session.ended"));await waitFor(()=>getSession(s.issued.sessionId)===null);
    expect(s.privateSelect).not.toHaveBeenCalled();expect(current().status).toBe("ended");expect(current().consumedSeconds).toBe(2);
    expect(current().segments[0]).toMatchObject({sourceText:"今天我们测试公共语音翻译。",translatedText:"Today we test public speech translation."});
    expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${s.issued.sessionId}`)).toHaveLength(1);
    expect(current().publicModelAttempts!.map(r=>r.event.component)).toEqual(voice?["asr","translation","tts"]:["asr","translation"]);
    expect(messages.some(e=>e.type==="audio.output")).toBe(voice);expect(JSON.stringify(messages)).not.toMatch(/SYNTHETIC|apiKey|secretKey|accessToken/);
    expect(s.calls.some(c=>c.path.endsWith("/credentials")&&c.headers["x-wujie-gateway-credential"]===access)).toBe(true);
  });
  it("rejects an incorrect credential access secret before opening a model or starting activity",async()=>{
    const s=await setup("qwen",false,"WRONG_SYNTHETIC_CREDENTIAL_ACCESS_SECRET");await waitFor(()=>ws!.readyState===WebSocket.CLOSED);
    expect(s.asrSocketFactory).not.toHaveBeenCalled();expect(current().status).toBe("created");expect(current().publicRuntime).toBeUndefined();expect(getSession(s.issued.sessionId)).toBeNull();
  });
  it("does not accept text injection as a substitute for the bound public ASR",async()=>{
    const s=await setup();await waitFor(()=>messages.some(e=>e.type==="session.started"));
    ws!.send(JSON.stringify({type:"client.text.segment",sessionId:s.issued.sessionId,segmentId:"injected",revision:1,text:"injected",language:"zh",isFinal:true}));
    await waitFor(()=>ws!.readyState===WebSocket.CLOSED);expect(s.modelFetchFn).not.toHaveBeenCalled();
  });
  it("closes on revoked activity without private fallback or deferred reconnect",async()=>{
    const s=await setup();await waitFor(()=>messages.some(e=>e.type==="session.started"));
    await revokePublicInferenceEvidence(s.issued.sessionId,current().userId,"consent",new Date());await waitFor(()=>ws!.readyState===WebSocket.CLOSED);
    await waitFor(()=>getSession(s.issued.sessionId)===null);expect(s.privateSelect).not.toHaveBeenCalled();expect(s.modelFetchFn).not.toHaveBeenCalled();
  });
  it("finalizes a normal unexpected disconnect immediately, without charging reconnect grace",async()=>{
    const s=await setup();await waitFor(()=>messages.some(e=>e.type==="session.started"));vi.setSystemTime(now.getTime()+1000);ws!.terminate();
    await waitFor(()=>getSession(s.issued.sessionId)===null);expect(current().status).toBe("ended");expect(current().consumedSeconds).toBe(1);
    expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${s.issued.sessionId}`)).toHaveLength(1);expect(s.modelFetchFn).not.toHaveBeenCalled();
    const observations=s.calls.filter(c=>c.path.endsWith("/runtime"));
    expect(observations.filter(c=>c.body.phase==="disconnected")).toHaveLength(1);
    expect(observations.at(-2)?.body.phase).toBe("disconnected");expect(observations.at(-1)?.body.phase).toBe("stopped");
  });
  it("saves the actual drained disconnect watermark before ending the same public session",async()=>{
    let checkpoint:any;
    const s=await setup("qwen",false,access,(path,body)=>{if(path.endsWith("/runtime")&&body.phase==="disconnected")checkpoint=structuredClone(current());});
    await waitFor(()=>messages.some(e=>e.type==="session.started"));vi.setSystemTime(now.getTime()+1000);
    ws!.send(JSON.stringify({type:"audio.frame",sessionId:s.issued.sessionId,sequence:1,timestampMs:0,format:"pcm16",sampleRate:16000,data:Buffer.alloc(3200).toString("base64")}));
    ws!.send(JSON.stringify({type:"audio.boundary",sessionId:s.issued.sessionId,sequence:1}));await waitFor(()=>messages.some(e=>e.type==="translation.final"));
    ws!.terminate();await waitFor(()=>getSession(s.issued.sessionId)===null);
    expect(checkpoint.publicRuntime).toMatchObject({phase:"disconnected",lastAcceptedSample:1600,uncertain:false});
    expect(checkpoint.publicFinalization).toBeUndefined();expect(checkpoint.segments[0]).toMatchObject({sourceText:"今天我们测试公共语音翻译。",translatedText:"Today we test public speech translation."});
    const inspected=s.calls.find(c=>c.path.endsWith("/admission")&&c.body.purpose==="recovery");expect(inspected).toBeDefined();
    expect(current().status).toBe("ended");expect(current().publicRuntime!.lastAcceptedSample).toBe(1600);
    expect(current().publicRuntime!.sequence).toBe(checkpoint.publicRuntime.sequence+1);
    expect(getStoreSnapshot().sessions).toHaveLength(1);expect(getStoreSnapshot().usageHolds).toHaveLength(1);
    expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${s.issued.sessionId}`)).toHaveLength(1);
    expect(s.asrSocketFactory).toHaveBeenCalledTimes(1);
  });
  it("an exhausted resume allowance does not prevent normal disconnect settlement",async()=>{
    const s=await setup();await waitFor(()=>messages.some(e=>e.type==="session.started"));
    vi.setSystemTime(now.getTime()+60000);ws!.terminate();await waitFor(()=>getSession(s.issued.sessionId)===null);
    expect(current().status).toBe("ended");expect(current().consumedSeconds).toBe(60);
    expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${s.issued.sessionId}`)).toHaveLength(1);
    expect(s.modelFetchFn).not.toHaveBeenCalled();
  });
  it("rejects a duplicate live connection before a second model socket is opened",async()=>{
    const s=await setup();await waitFor(()=>messages.some(e=>e.type==="session.started"));const address=server!.address() as {port:number};
    const second=new WebSocket(`ws://127.0.0.1:${address.port}/realtime`,["ai-phone.realtime.v1",`ai-phone.token.${s.issued.realtimeToken}`],{headers:{host:"127.0.0.1"}});
    await once(second,"close");expect(s.asrSocketFactory).toHaveBeenCalledTimes(1);expect(ws!.readyState).toBe(WebSocket.OPEN);
  });
  it("recovers a committed stop after every stop ACK is lost without another model call or settlement",async()=>{
    let lost=0;
    const s=await setup("qwen",false,access,(path,body)=>{
      if(path.endsWith("/runtime")&&body.phase==="stopped"){lost++;throw Error("Synthetic committed stop ACK lost");}
    });
    await waitFor(()=>messages.some(e=>e.type==="session.started"));vi.setSystemTime(now.getTime()+1000);
    ws!.send(JSON.stringify({type:"audio.frame",sessionId:s.issued.sessionId,sequence:1,timestampMs:0,format:"pcm16",sampleRate:16000,data:Buffer.alloc(3200).toString("base64")}));
    ws!.send(JSON.stringify({type:"audio.boundary",sessionId:s.issued.sessionId,sequence:1}));
    await waitFor(()=>messages.some(e=>e.type==="translation.final"));
    vi.setSystemTime(now.getTime()+2000);ws!.send(JSON.stringify({type:"session.end",sessionId:s.issued.sessionId}));
    await waitFor(()=>getSession(s.issued.sessionId)===null);
    expect(lost).toBe(3);expect(messages.some(e=>e.type==="session.ended")).toBe(false);
    const committed=structuredClone(current()),modelCalls=s.modelFetchFn.mock.calls.length;
    expect(committed.status).toBe("ended");expect(committed.consumedSeconds).toBe(2);expect(committed.segments[0].translatedText).toBe("Today we test public speech translation.");
    const stops=s.calls.filter(c=>c.path.endsWith("/runtime")&&c.body.phase==="stopped");expect(stops.every(c=>JSON.stringify(c.body)===JSON.stringify(stops[0].body))).toBe(true);
    // Rebuild API and reload a serialized original snapshot, without re-opening
    // a Gateway or installing a real supplier/authority. Not a process-restart test.
    await app.close();Object.assign(getStoreSnapshot(),normalizeStoreSnapshot(JSON.parse(JSON.stringify(getStoreSnapshot()))));app=await buildApp();
    vi.setSystemTime(now.getTime()+900000);
    for(let i=0;i<2;i++){
      const recovery=await app.inject({url:`/realtime/sessions/${s.issued.sessionId}/recovery`});expect(recovery.statusCode).toBe(200);
      expect(recovery.json()).toMatchObject({canResume:false,canFinalize:true,meterStatus:"verified",finalization:committed.publicFinalization!.ack});
      const retry=await app.inject({method:"POST",url:`/realtime/sessions/${s.issued.sessionId}/finalize`,payload:finalization.serverFinalizationRequest(current())});
      expect(retry.statusCode).toBe(200);expect(retry.json()).toEqual(committed.publicFinalization!.ack);
    }
    expect(current()).toEqual(committed);expect(getStoreSnapshot().sessions).toHaveLength(1);
    expect(getStoreSnapshot().usageHolds).toHaveLength(1);expect(getStoreSnapshot().usageHolds[0].status).toBe("settled");
    expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${s.issued.sessionId}`)).toHaveLength(1);
    expect(s.modelFetchFn).toHaveBeenCalledTimes(modelCalls);expect(s.asrSocketFactory).toHaveBeenCalledTimes(1);
  });
  it("original stale recovery finishes a confirmed stop whose settlement temporarily failed, after the client window",async()=>{
    const s=await setup();await waitFor(()=>messages.some(e=>e.type==="session.started"));vi.setSystemTime(now.getTime()+1000);
    const blocked=vi.spyOn(finalization,"finalizePublicSession").mockRejectedValue(Error("Synthetic settlement unavailable"));
    ws!.send(JSON.stringify({type:"session.end",sessionId:s.issued.sessionId}));await waitFor(()=>getSession(s.issued.sessionId)===null);
    expect(current().publicRuntime).toMatchObject({phase:"stopped",uncertain:false});expect(current().publicFinalization).toBeUndefined();
    expect(getStoreSnapshot().billingLedger).toHaveLength(0);expect(getStoreSnapshot().usageHolds[0].status).toBe("active");blocked.mockRestore();
    vi.setSystemTime(now.getTime()+900000);
    const expired=await app.inject({method:"POST",url:`/realtime/sessions/${s.issued.sessionId}/finalize`,payload:finalization.serverFinalizationRequest(current())});
    expect(expired.statusCode).toBe(409);expect(current().publicFinalization).toBeUndefined();
    expect((await recoverStaleRealtimeSessions()).recoveredCount).toBe(1);
    expect(current().status).toBe("ended");expect(current().consumedSeconds).toBe(1);
    expect((await recoverStaleRealtimeSessions()).recoveredCount).toBe(0);
    expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${s.issued.sessionId}`)).toHaveLength(1);
    expect(s.modelFetchFn).not.toHaveBeenCalled();expect(s.asrSocketFactory).toHaveBeenCalledTimes(1);
  });
});
