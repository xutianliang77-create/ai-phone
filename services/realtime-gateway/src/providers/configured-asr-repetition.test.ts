import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {AudioFrame,PublicModelAttemptEvent,ServerRealtimeEvent} from '@translation/contracts';
import {configuredPublicSessionComponents,type ConfiguredPublicSessionOptions} from './configured-public-session.js';
import {SyntheticQwenAudioSocket} from '../asr/qwen-audio-streaming.test-support.js';
import {SyntheticAsrSocket} from '../asr/streaming-asr.test-support.js';
import {markAcceptedAudioRange} from '../connection/accepted-audio-range.js';
const bad=JSON.parse(readFileSync(new URL('../asr/fixtures/longrun-repetition-0108.json',import.meta.url),'utf8')).segments[86].text;
const tick=()=>new Promise(r=>setImmediate(r));
it.each(['qwen_audio_streaming','openai_realtime_asr'] as const)('original configured %s → MT/TTS issues no downstream attempt for bad input',async protocol=>{
  const qwen=protocol==='qwen_audio_streaming',rate=qwen?16000:24000;
  let socket!:SyntheticQwenAudioSocket|SyntheticAsrSocket;
  const records:PublicModelAttemptEvent[]=[],mt=vi.fn(async()=>new Response(JSON.stringify({Response:{TargetText:'Continue testing.',RequestId:'synthetic'}}))),
    tts=vi.fn(async()=>new Response(Buffer.alloc(1920),{headers:{'content-type':'audio/pcm'}}));
  const plan={asr:{execution:'public',scopeKey:'asr',reason:'online_selected'},translation:{execution:'public',scopeKey:'mt',reason:'online_selected'},tts:{execution:'public',scopeKey:'tts',reason:'online_selected'}} as const;
  const options:ConfiguredPublicSessionOptions={
    session:{sessionId:'session',userId:'owner',sourceLanguage:'zh',targetLanguage:'en',voiceOutput:true},
    binding:{sessionId:'session',ownerId:'owner',deploymentId:'public',modelPolicyRevision:'policy',leaseId:'lease',captureId:'capture',languagePolicyKey:'language:1',sampleRate:rate},
    authorization:{contractVersion:1,processingMode:'online',modelPolicyRevision:'policy',publicGrantRef:'grant',executionPlan:plan,
      languagePolicy:{source:'zh',target:'en',autoReverse:false,revision:1},syncPermission:{allowed:false}},
    snapshot:{deploymentId:'public',configurationRevision:1,configurationHash:'a'.repeat(64),modelPolicyRevision:'policy',executionPlan:plan,
      components:{asr:{enabled:true,vendor:qwen?'qwen':'openai',protocol,authKind:'api_key',endpoint:'wss://synthetic.invalid'+(qwen?'/api-ws/v1/inference':'/v1/realtime'),modelId:qwen?'qwen-audio-3.1-asr-flash-streaming':'manual-asr',timeoutMs:1000,sampleRate:rate},
        translation:{enabled:true,vendor:'tencent',protocol:'tencent_tmt',authKind:'tencent_secret',endpoint:'https://synthetic.invalid',region:'ap-guangzhou',modelId:'service:tencent_tmt',maxTokens:700,timeoutMs:1000},
        tts:{enabled:true,vendor:'openai',protocol:'openai_speech',authKind:'api_key',endpoint:'https://synthetic.invalid/v1',modelId:'manual-tts',voice:'coral',timeoutMs:1000,sampleRate:24000}}},
    authorizeConnection:async()=>{},resolveAsrCredentials:()=>({apiKey:'SYNTHETIC'}),resolveTranslationCredentials:()=>({secretId:'SYNTHETIC',secretKey:'SYNTHETIC'}),
    recordAttempt:async e=>{records.push(e);},fetchFn:mt,socketFactory:vi.fn(()=>{
      socket=qwen?new SyntheticQwenAudioSocket():new SyntheticAsrSocket();if(socket instanceof SyntheticAsrSocket)socket.transcript=bad;return socket.asWebSocket();}),
    output:{prefillMs:20,isSessionActive:()=>true,resolveCredentials:()=>({apiKey:'SYNTHETIC'}),fetchFn:tts}};
  const {provider,ttsOutput}=configuredPublicSessionComponents(options),events:ServerRealtimeEvent[]=[];
  const feed=async(g:AsyncGenerator<ServerRealtimeEvent>)=>{for await(const e of g){events.push(e);ttsOutput!.enqueue(e,a=>events.push(a));}await ttsOutput!.drain();};
  const frame=(n:number)=>{const f:AudioFrame={type:'audio.frame',sessionId:'session',sequence:n,timestampMs:n*6000,format:'pcm16',sampleRate:rate,data:Buffer.alloc(rate*12).toString('base64')};markAcceptedAudioRange(f,{startSample:n*rate*6,endSample:(n+1)*rate*6});return f;};
  try{
    await provider.createSession(options.session);await feed(provider.sendAudio(frame(0)));
    if(socket instanceof SyntheticQwenAudioSocket){socket.sentence(1,bad);await tick();}
    await feed(provider.flushSession('session'));
    expect(events).toContainEqual(expect.objectContaining({type:'translation.failed',stage:'asr'}));
    expect(mt).not.toHaveBeenCalled();expect(tts).not.toHaveBeenCalled();
    expect(records.filter(e=>e.component==='translation'||e.component==='tts')).toEqual([]);
    if(socket instanceof SyntheticAsrSocket)socket.transcript='接下来继续测试。';
    await feed(provider.sendAudio(frame(1)));
    if(socket instanceof SyntheticQwenAudioSocket){socket.receive('result-generated',{output:{sentence:{sentence_id:2,text:'接下来继续测试。',sentence_end:true,begin_time:6000,end_time:11000,words:[]}}});await tick();}
    await feed(provider.flushSession('session',{finishSession:true}));
    expect(mt).toHaveBeenCalledTimes(1);expect(tts).toHaveBeenCalledTimes(1);
    expect(records.filter(e=>e.component==='translation'&&e.state==='confirmed')).toHaveLength(1);
    expect(records.filter(e=>e.component==='tts'&&e.state==='confirmed')).toHaveLength(1);
    expect(options.socketFactory).toHaveBeenCalledTimes(1);expect(events.some(e=>e.type==='audio.output')).toBe(true);
    expect(events.some(e=>e.type==='error')).toBe(false);
  }finally{ttsOutput!.close();await ttsOutput!.drainInFlight();await provider.closeSession('session');}
});
