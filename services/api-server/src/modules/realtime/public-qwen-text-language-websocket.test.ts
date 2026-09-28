import {once} from 'node:events';
import type {Server} from 'node:http';
import WebSocket from 'ws';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../../app.js';
import {installConfigurationFixture,body,current,evidence,now} from '../sessions/public-model-configuration.test-support.js';
import {getStoreSnapshot} from '../../infrastructure/storage/json-store.js';
import {savePublicModelConfiguration} from '../models/public-model-config-store.js';
import {capturePublicModelRuntimeConfiguration} from '../models/public-model-runtime-config.js';
import {startWebSocketServer} from '../../../../realtime-gateway/src/connection/websocket-server.js';
import {getSession} from '../../../../realtime-gateway/src/sessions/session-manager.js';
import {SyntheticQwenAudioSocket} from '../../../../realtime-gateway/src/asr/qwen-audio-streaming.test-support.js';
const signer='SYNTHETIC_QWEN_SIGNER_NOT_REAL_0001',internal='SYNTHETIC_QWEN_INTERNAL_NOT_REAL_0002',access='SYNTHETIC_QWEN_CREDENTIAL_NOT_REAL_0003';
let app:FastifyInstance,server:Server|undefined,ws:WebSocket|undefined,peer:SyntheticQwenAudioSocket;
const messages:any[]=[];
installConfigurationFixture();
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);messages.length=0;
  for(const [key,value]of Object.entries({API_TEST_AUTO_ACCOUNT:'true',REALTIME_TOKEN_SECRET:signer,INTERNAL_API_SECRET:internal,
    REALTIME_WS_ENDPOINT:'wss://gateway.synthetic.invalid/realtime',API_BASE_URL:'https://api.synthetic.invalid',MODEL_ROUTING_FILE:'',
    REALTIME_BIND_HOST:'127.0.0.1',REALTIME_PORT:'0',REALTIME_PROVIDER:'mock',ASR_PROVIDER:'mock',SESSION_EVENT_SINK:'api',
    PUBLIC_RATE_LIMIT_PROVIDER:'memory',REALTIME_ALLOWED_HOSTS:'127.0.0.1',REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN:'true',REALTIME_ALLOW_QUERY_TOKEN:'false'}))vi.stubEnv(key,value);
  const store=getStoreSnapshot();store.sessions=[];store.usageHolds=[];store.billingLedger=[];store.usageBalances={};store.usagePlanCodes={};
  app=await buildApp({publicGatewayCredentialAccess:{secret:access},publicRealtimeAuthority:{timeoutMs:2000,
    resolveVerifiedEvidence:async()=>({records:evidence(),refs:{consentReceiptId:'consent',budgetReservationId:'budget',qualificationReceiptIds:{asr:'asr',translation:'translation'}}})}});
});
afterEach(async()=>{
  if(ws&&ws.readyState!==WebSocket.CLOSED){const closed=once(ws,'close');ws.terminate();await closed;}ws=undefined;
  if(server){await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}
  if(current())await waitFor(()=>getSession(current().id)===null);
  await app.close();vi.useRealTimers();
});
async function waitFor(test:()=>boolean){const until=performance.now()+5000;while(!test()){
  if(performance.now()>until)throw Error('condition timed out: '+JSON.stringify(messages));await new Promise(r=>setTimeout(r,10));
}}
async function setup(capability=true){
  const update=body(1);Object.assign(update.components.asr,{protocol:'qwen_audio_streaming',modelId:'qwen-audio-3.1-asr-flash-streaming',endpoint:'wss://synthetic.invalid/api-ws/v1/inference'});
  await savePublicModelConfiguration(update);const config=capturePublicModelRuntimeConfiguration(false);
  const languagePolicy={source:'auto',target:'en',autoReverse:true,pair:['zh','en'],sourceLanguages:['zh','en','fr'],revision:1};
  const issuedResponse=await app.inject({method:'POST',url:'/realtime/sessions',headers:{'idempotency-key':'qwen-language-websocket'},payload:{
    mode:'conversation',sourceLanguage:'auto',targetLanguage:'en',autoReverseTargetLanguage:true,voiceOutput:false,speakerAttribution:{mode:'off'},
    processing:{contractVersion:1,processingMode:'online',modelPolicyRevision:config.modelPolicyRevision,executionPlan:config.executionPlan,languagePolicy,syncRequested:false}}});
  expect(issuedResponse.statusCode,issuedResponse.body).toBe(200);const issued=issuedResponse.json();
  const apiFetchFn=vi.fn(async(url:any,init:any)=>{const r=await app.inject({method:'POST',url:new URL(String(url)).pathname,headers:init.headers,payload:JSON.parse(init.body)});return new Response(r.body,{status:r.statusCode});});
  const modelFetchFn=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'大家好。'}}]})));
  const asrSocketFactory=vi.fn(()=>{peer=new SyntheticQwenAudioSocket();return peer.asWebSocket();});
  server=startWebSocketServer({publicRuntime:{credentialAccessSecret:access,apiFetchFn,modelFetchFn,asrSocketFactory}});await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw Error();
  ws=new WebSocket(`ws://127.0.0.1:${address.port}/realtime`,['ai-phone.realtime.v1',`ai-phone.token.${issued.realtimeToken}`,
    ...(capability?['ai-phone.text-language.v1']:[])],{headers:{host:'127.0.0.1'}});
  ws.on('message',data=>messages.push(JSON.parse(data.toString())));await once(ws,'open');
  return {issued,modelFetchFn,asrSocketFactory,apiFetchFn};
}
it.each([true,false])('end queue consumes phone LID without deadlock; detected=%s persists correctly and settles once',async(detected)=>{
  const t=await setup();await waitFor(()=>messages.some(e=>e.type==='session.started'));
  vi.setSystemTime(now.getTime()+1000);
  ws!.send(JSON.stringify({type:'audio.frame',sessionId:t.issued.sessionId,sequence:1,timestampMs:0,format:'pcm16',sampleRate:16000,data:Buffer.alloc(3200).toString('base64')}));
  ws!.send(JSON.stringify({type:'audio.boundary',sessionId:t.issued.sessionId,sequence:1}));await waitFor(()=>peer.bytes===3200);
  const text=detected?'Bonjour tout le monde.':'Okay.';peer.sentence(1,text);await waitFor(()=>messages.some(e=>e.type==='text.language.request'));
  const {text:original,...challenge}=messages.find(e=>e.type==='text.language.request');expect(original).toBe(text);
  vi.setSystemTime(now.getTime()+4000);ws!.send(JSON.stringify({type:'session.end',sessionId:t.issued.sessionId}));
  await waitFor(()=>!!current().publicRuntime?.meterStoppedAt);
  ws!.send(JSON.stringify({...challenge,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:detected?'fr':'en',hypotheses:detected?{fr:0.99}:{en:0.99}}));
  await waitFor(()=>messages.some(e=>e.type==='session.ended'));await waitFor(()=>getSession(t.issued.sessionId)===null);
  expect(current().status).toBe('ended');expect(current().consumedSeconds).toBe(4);
  expect(current().segments[0]).toMatchObject({sourceText:text,sourceLanguage:detected?'fr':'auto'});
  expect(t.modelFetchFn).toHaveBeenCalledTimes(detected?1:0);expect(t.asrSocketFactory).toHaveBeenCalledTimes(1);
  expect(current().publicModelAttempts?.filter(e=>e.event.component==='asr'&&e.event.state==='confirmed')).toHaveLength(1);
  expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${t.issued.sessionId}`)).toHaveLength(1);
  expect(messages.filter(e=>e.type==='error')).toEqual([]);
});
it('old/unsupported clients are rejected before credentials or ASR, not silently assigned a language',async()=>{
  const t=await setup(false);await waitFor(()=>ws!.readyState===WebSocket.CLOSED);
  expect(t.asrSocketFactory).not.toHaveBeenCalled();expect(t.modelFetchFn).not.toHaveBeenCalled();
  expect(t.apiFetchFn.mock.calls.some(c=>String(c[0]).endsWith('/credentials'))).toBe(false);
  expect(current().status).toBe('created');expect(current().publicRuntime).toBeUndefined();
});
