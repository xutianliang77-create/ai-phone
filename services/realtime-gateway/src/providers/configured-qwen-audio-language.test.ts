import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {AudioFrame,PublicModelAttemptEvent} from '@translation/contracts';
import {configuredPublicSession,type ConfiguredPublicSessionOptions} from './configured-public-session.js';
import {SyntheticQwenAudioSocket} from '../asr/qwen-audio-streaming.test-support.js';
import {DeviceTextLanguageBroker} from '../connection/device-text-language.js';
import {markAcceptedAudioRange} from '../connection/accepted-audio-range.js';
const fixture=JSON.parse(readFileSync(new URL('../../../../packages/contracts/fixtures/qwen-audio-streaming-wire-20260928.json',import.meta.url),'utf8'));

it('actual vendor wire + device text LID follows ORIGINAL MT routing incl reverse/third languages, once per attempt',async()=>{
  let socket!:SyntheticQwenAudioSocket,replyIndex=0;
  const attempts:PublicModelAttemptEvent[]=[],requests:Array<{Source:string;Target:string}>=[];
  const sources=['zh','en','ja','fr'] as const,pair=['zh','en'] as const;
  const textLanguage=new DeviceTextLanguageBroker('session',sources,r=>{
    const {text,...binding}=r,language=['en','ja','fr','zh-Hans'][replyIndex++];
    queueMicrotask(()=>textLanguage.accept({...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:language,hypotheses:{[language]:0.99}}));return true;
  });
  const plan={asr:{execution:'public',scopeKey:'asr',reason:'online_selected'},translation:{execution:'public',scopeKey:'mt',reason:'online_selected'},tts:{execution:'disabled'}} as const;
  const options:ConfiguredPublicSessionOptions={
    session:{sessionId:'session',userId:'owner',sourceLanguage:'auto',targetLanguage:'en',autoReverseTargetLanguage:true,
      languagePair:pair,automaticSourceLanguages:sources,asrEndpointMode:'listening',voiceOutput:false},
    binding:{sessionId:'session',ownerId:'owner',deploymentId:'public',modelPolicyRevision:'policy',leaseId:'lease',captureId:'capture',languagePolicyKey:'language:1',sampleRate:16000},
    authorization:{contractVersion:1,processingMode:'online',modelPolicyRevision:'policy',publicGrantRef:'grant',executionPlan:plan,
      languagePolicy:{source:'auto',target:'en',autoReverse:true,pair,sourceLanguages:sources,revision:1},syncPermission:{allowed:false}},
    snapshot:{deploymentId:'public',configurationRevision:1,configurationHash:'a'.repeat(64),modelPolicyRevision:'policy',executionPlan:plan,
      components:{asr:{enabled:true,vendor:'qwen',protocol:'qwen_audio_streaming',authKind:'api_key',endpoint:'wss://synthetic.invalid/api-ws/v1/inference',modelId:'qwen-audio-3.1-asr-flash-streaming',timeoutMs:500,sampleRate:16000},
        translation:{enabled:true,vendor:'tencent',protocol:'tencent_tmt',authKind:'tencent_secret',endpoint:'https://synthetic.invalid',region:'ap-guangzhou',modelId:'service:tencent_tmt',maxTokens:700,timeoutMs:1000}}},
    textLanguage,authorizeConnection:vi.fn(async()=>{}),resolveAsrCredentials:()=>({apiKey:'SYNTHETIC'}),
    resolveTranslationCredentials:()=>({secretId:'SYNTHETIC',secretKey:'SYNTHETIC'}),recordAttempt:async e=>{attempts.push(e);},
    socketFactory:vi.fn(()=>{socket=new SyntheticQwenAudioSocket();socket.autoFinish=false;return socket.asWebSocket();}),fetchFn:vi.fn(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));requests.push(body);
      return new Response(JSON.stringify({Response:{TargetText:body.Target==='zh'?'翻译结果。':'The translated result.',RequestId:'synthetic'}}));
    })};
  expect(()=>configuredPublicSession({...options,textLanguage:undefined})).toThrow('device_text_language');
  const provider=configuredPublicSession(options),events:any[]=[];
  try{
    await provider.createSession(options.session);
    const frame:AudioFrame={type:'audio.frame',sessionId:'session',sequence:1,timestampMs:0,format:'pcm16',sampleRate:16000,data:Buffer.alloc(896000).toString('base64')};
    markAcceptedAudioRange(frame,{startSample:0,endSample:448000});
    for await(const event of provider.sendAudio(frame))events.push(event);
    const rawEvents=fixture.events;
    for(const raw of rawEvents.filter((e:any)=>e.header.event==='result-generated'))socket.receive(raw.header.event,raw.payload);
    const ending=(async()=>{for await(const event of provider.flushSession('session',{finishSession:true}))events.push(event);})();
    await new Promise(resolve=>setImmediate(resolve));
    const finished=rawEvents.find((e:any)=>e.header.event==='task-finished');socket.receive('task-finished',finished.payload);await ending;
    expect(events.filter(e=>e.type==='error'||e.type==='translation.failed')).toEqual([]);
    expect(requests.map(r=>[r.Source,r.Target])).toEqual([['en','zh'],['ja','zh'],['fr','zh'],['zh','en']]);
    expect(events.filter(e=>e.type==='transcript.final'&&e.text).map(e=>e.language)).toEqual(['en','ja','fr','zh']);
    expect(options.socketFactory).toHaveBeenCalledTimes(1);
    expect(attempts.filter(e=>e.component==='asr'&&e.state==='confirmed')).toEqual([expect.objectContaining({metadata:expect.objectContaining({usage:{promptTokens:686,completionTokens:50,totalTokens:736,audioSeconds:25}})})]);
    expect(attempts.filter(e=>e.component==='translation'&&e.state==='confirmed')).toHaveLength(4);
  }finally{await provider.closeSession('session');}
});
