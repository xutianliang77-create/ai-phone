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
import {revokePublicInferenceEvidence} from '../sessions/public-inference-admission.service.js';
import {startWebSocketServer} from '../../../../realtime-gateway/src/connection/websocket-server.js';
import {getSession,deleteSession} from '../../../../realtime-gateway/src/sessions/session-manager.js';
import {SyntheticQwenAudioSocket} from '../../../../realtime-gateway/src/asr/qwen-audio-streaming.test-support.js';
const signer='SYNTHETIC_PAUSE_SIGNER_NOT_REAL_0001',internal='SYNTHETIC_PAUSE_INTERNAL_NOT_REAL_0002',access='SYNTHETIC_PAUSE_CREDENTIAL_NOT_REAL_0003';
let app:FastifyInstance,server:Server|undefined,ws:WebSocket,peer:SyntheticQwenAudioSocket;
let messages:any[]=[],issued:any;
const clients:WebSocket[]=[];
installConfigurationFixture();
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);messages=[];clients.length=0;peer=undefined!;
  for(const [key,value]of Object.entries({API_TEST_AUTO_ACCOUNT:'true',REALTIME_TOKEN_SECRET:signer,INTERNAL_API_SECRET:internal,
    REALTIME_WS_ENDPOINT:'wss://gateway.synthetic.invalid/realtime',API_BASE_URL:'https://api.synthetic.invalid',MODEL_ROUTING_FILE:'',
    REALTIME_BIND_HOST:'127.0.0.1',REALTIME_PORT:'0',REALTIME_PROVIDER:'mock',ASR_PROVIDER:'mock',SESSION_EVENT_SINK:'api',
    PUBLIC_RATE_LIMIT_PROVIDER:'memory',REALTIME_ALLOWED_HOSTS:'127.0.0.1',REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN:'true',REALTIME_ALLOW_QUERY_TOKEN:'false'}))vi.stubEnv(key,value);
  const store=getStoreSnapshot();store.sessions=[];store.usageHolds=[];store.billingLedger=[];store.usageBalances={};store.usagePlanCodes={};
  app=await buildApp({publicGatewayCredentialAccess:{secret:access},publicRealtimeAuthority:{timeoutMs:2000,
    resolveVerifiedEvidence:async()=>({records:evidence(),refs:{consentReceiptId:'consent',budgetReservationId:'budget',qualificationReceiptIds:{asr:'asr',translation:'translation'}}})}});
});
afterEach(async()=>{
  for(const client of clients)if(client.readyState!==WebSocket.CLOSED){const closed=once(client,'close');client.terminate();await closed;}
  // A failed assertion may leave a deliberately retained runtime. Do not wait
  // five real minutes in a synthetic test; release that exact test aggregate.
  if(current())deleteSession(current().id);
  if(server){await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}
  await app.close();vi.useRealTimers();
});
async function waitFor(test:()=>boolean){const until=performance.now()+5000;while(!test()){
  if(performance.now()>until)throw Error('condition timed out: '+JSON.stringify(messages));await new Promise(r=>setTimeout(r,10));
}}
async function connect(capability=true){
  const address=server!.address() as {port:number};messages=[];
  const socket=new WebSocket(`ws://127.0.0.1:${address.port}/realtime`,['ai-phone.realtime.v1',`ai-phone.token.${issued.realtimeToken}`,
    ...(capability?['ai-phone.text-language.v1','ai-phone.speech-evidence.v1']:[])],{headers:{host:'127.0.0.1'}});
  clients.push(socket);ws=socket;
  socket.on('message',raw=>{
    const event=JSON.parse(raw.toString());messages.push(event);
    if(event.type==='text.language.request'){
      const {text,audioRange,...challenge}=event;
      socket.send(JSON.stringify({...challenge,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'zh-Hans',hypotheses:{'zh-Hans':0.99},
        ...(audioRange?{audioEvidence:{method:'ios_silero_render_v1',range:audioRange,decision:'speech',reason:'speech_overlap',coveredThroughSample:audioRange.endSample}}:{})}));
    }
  });
  await once(socket,'open');return socket;
}
async function setup(){
  const update=body(1);Object.assign(update.components.asr,{protocol:'qwen_audio_streaming',modelId:'qwen-audio-3.1-asr-flash-streaming',endpoint:'wss://synthetic.invalid/api-ws/v1/inference'});
  await savePublicModelConfiguration(update);const config=capturePublicModelRuntimeConfiguration(false);
  const languagePolicy={source:'auto',target:'en',autoReverse:true,pair:['zh','en'],sourceLanguages:['zh','en','fr'],revision:1};
  const response=await app.inject({method:'POST',url:'/realtime/sessions',headers:{'idempotency-key':'paused-language-websocket'},payload:{
    mode:'conversation',sourceLanguage:'auto',targetLanguage:'en',autoReverseTargetLanguage:true,voiceOutput:false,speakerAttribution:{mode:'off'},
    processing:{contractVersion:1,processingMode:'online',modelPolicyRevision:config.modelPolicyRevision,executionPlan:config.executionPlan,languagePolicy,syncRequested:false}}});
  expect(response.statusCode,response.body).toBe(200);issued=response.json();
  const apiFetchFn=vi.fn(async(url:any,init:any)=>{const r=await app.inject({method:'POST',url:new URL(String(url)).pathname,headers:init.headers,payload:JSON.parse(init.body)});return new Response(r.body,{status:r.statusCode});});
  const modelFetchFn=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'The resumed translation is complete.'}}]})));
  const asrSocketFactory=vi.fn(()=>{peer=new SyntheticQwenAudioSocket();return peer.asWebSocket();});
  server=startWebSocketServer({publicRuntime:{credentialAccessSecret:access,apiFetchFn,modelFetchFn,asrSocketFactory,pausedLifecycleRecovery:true}});await once(server,'listening');
  await connect();await waitFor(()=>messages.some(e=>e.type==='session.started'));
  return {apiFetchFn,modelFetchFn,asrSocketFactory};
}
function send(type:string,fields:Record<string,unknown>={}){ws.send(JSON.stringify({type,sessionId:issued.sessionId,...fields}));}
async function audio(sequence:number){
  send('audio.frame',{sequence,timestampMs:sequence*100,format:'pcm16',sampleRate:16000,data:Buffer.alloc(3200).toString('base64')});
  await waitFor(()=>peer?.bytes===sequence*3200);
}
async function pause(){
  const count=messages.filter(e=>e.type==='session.paused').length;
  send('session.pause');await waitFor(()=>messages.filter(e=>e.type==='session.paused').length>count);
}
async function disconnect(){const closed=once(ws,'close');ws.terminate();await closed;
  await waitFor(()=>!!getSession(issued.sessionId)?.publicRecoveryRuntime);
}
it('two real socket losses after confirmed pause reuse Qwen, LID, watermarks and one settlement',async()=>{
  const t=await setup();await audio(1);vi.setSystemTime(now.getTime()+1000);await pause();
  await disconnect();const saved=getSession(issued.sessionId)!.publicRecoveryRuntime!;
  expect(saved.pausedLifecycle).toBe(true);expect(current().status).toBe('paused');
  expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  for(let cycle=1;cycle<=2;cycle++){
    const before=t.apiFetchFn.mock.calls.length;
    await connect();await waitFor(()=>messages.some(e=>e.type==='session.recovery.ready'));
    const bridge=messages.find(e=>e.type==='session.recovery.ready');
    expect(bridge).toMatchObject({lastAcceptedSample:cycle*1600,nextSequence:cycle+1});
    expect(t.asrSocketFactory).toHaveBeenCalledTimes(1);
    expect(t.apiFetchFn.mock.calls.slice(before).some(c=>/\/(credentials|configuration)$/.test(String(c[0])))).toBe(false);
    vi.setSystemTime(now.getTime()+cycle*10000);
    send('session.resume',{recovery:{lastAcceptedSample:bridge.lastAcceptedSample,nextSequence:bridge.nextSequence}});
    await waitFor(()=>messages.some(e=>e.type==='session.resumed'));
    await audio(cycle+1);
    peer.sentence(cycle,'今天我们检查锁屏恢复。',false);
    await waitFor(()=>messages.some(e=>e.type==='transcript.partial'));
    peer.sentence(cycle,'今天我们检查锁屏恢复。');
    await waitFor(()=>messages.some(e=>e.type==='text.language.request'&&e.segmentId.endsWith(`:${cycle}`)));
    vi.setSystemTime(now.getTime()+cycle*10000+1000);await pause();
    expect(messages.some(e=>e.type==='translation.final')).toBe(true);
    expect(messages.some(e=>e.type==='error'||e.type==='translation.skipped')).toBe(false);
    // An ordinary pause/resume on the recovered socket consumes no second bridge.
    const resumed=messages.filter(e=>e.type==='session.resumed').length;
    send('session.resume');await waitFor(()=>messages.filter(e=>e.type==='session.resumed').length>resumed);await pause();
    if(cycle===1){await disconnect();expect(getSession(issued.sessionId)!.publicRecoveryRuntime!.provider).toBe(saved.provider);}
  }
  send('session.end');await waitFor(()=>messages.some(e=>e.type==='session.ended'));await waitFor(()=>getSession(issued.sessionId)===null);
  expect(current()).toMatchObject({status:'ended',consumedSeconds:3});
  expect(current().segments.every(s=>!!s.sourceText&&!!s.translatedText)).toBe(true);
  expect(current().publicRuntime!.lastAcceptedSample).toBe(4800);
  expect(t.asrSocketFactory).toHaveBeenCalledTimes(1);
  expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${issued.sessionId}`)).toHaveLength(1);
});
it('active disconnect still finalizes rather than enabling default automatic recovery',async()=>{
  const t=await setup();await audio(1);vi.setSystemTime(now.getTime()+1000);
  ws.terminate();await waitFor(()=>getSession(issued.sessionId)===null);
  expect(current().status).toBe('ended');expect(t.asrSocketFactory).toHaveBeenCalledTimes(1);
  expect(getStoreSnapshot().billingLedger.filter(e=>e.idempotencyKey===`settle:${issued.sessionId}`)).toHaveLength(1);
});
it.each(['capability','authority'])('rejects changed %s before consuming the retained runtime or opening another ASR',async(kind)=>{
  const t=await setup();await audio(1);await pause();await disconnect();const saved=getSession(issued.sessionId)!.publicRecoveryRuntime;
  if(kind==='authority')await revokePublicInferenceEvidence(issued.sessionId,current().userId,'consent',new Date());
  const before=t.apiFetchFn.mock.calls.length;await connect(kind!=='capability');await waitFor(()=>ws.readyState===WebSocket.CLOSED);
  expect(getSession(issued.sessionId)!.publicRecoveryRuntime).toBe(saved);expect(t.asrSocketFactory).toHaveBeenCalledTimes(1);
  expect(t.apiFetchFn.mock.calls.slice(before).some(c=>/\/(credentials|configuration)$/.test(String(c[0])))).toBe(false);
});
