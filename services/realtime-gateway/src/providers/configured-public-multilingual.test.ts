import {it,expect,vi} from 'vitest';
import type {AudioFrame,PublicModelAttemptEvent} from '@translation/contracts';
import {configuredPublicSession,type ConfiguredPublicSessionOptions} from './configured-public-session.js';
import {SyntheticQwenAsrSocket} from '../asr/qwen-streaming-asr.test-support.js';
import {markAcceptedAudioRange} from '../connection/accepted-audio-range.js';

it('keeps one ASR connection and translates Chinese, English, Japanese and French through the inherited Provider',async()=>{
  let socket:SyntheticQwenAsrSocket;
  const attempts:PublicModelAttemptEvent[]=[],requests:Array<{Source:string;Target:string}>=[];
  const plan={asr:{execution:'public',scopeKey:'asr',reason:'online_selected'},translation:{execution:'public',scopeKey:'mt',reason:'online_selected'},tts:{execution:'disabled'}} as const;
  const sources=['zh','en','ja','fr'] as const,pair=['zh','en'] as const;
  const options:ConfiguredPublicSessionOptions={
    session:{sessionId:'session',userId:'owner',sourceLanguage:'auto',targetLanguage:'en',autoReverseTargetLanguage:true,
      languagePair:pair,automaticSourceLanguages:sources,asrEndpointMode:'listening',voiceOutput:false},
    binding:{sessionId:'session',ownerId:'owner',deploymentId:'public',modelPolicyRevision:'policy',leaseId:'lease',captureId:'capture',languagePolicyKey:'language:1',sampleRate:16000},
    authorization:{contractVersion:1,processingMode:'online',modelPolicyRevision:'policy',publicGrantRef:'grant',executionPlan:plan,
      languagePolicy:{source:'auto',target:'en',autoReverse:true,pair,sourceLanguages:sources,revision:1},syncPermission:{allowed:false}},
    snapshot:{deploymentId:'public',configurationRevision:1,configurationHash:'a'.repeat(64),modelPolicyRevision:'policy',executionPlan:plan,
      components:{asr:{enabled:true,vendor:'qwen',protocol:'qwen_asr_realtime',authKind:'api_key',endpoint:'wss://synthetic.invalid/api-ws/v1/realtime',modelId:'manual-asr',timeoutMs:500,sampleRate:16000},
        translation:{enabled:true,vendor:'tencent',protocol:'tencent_tmt',authKind:'tencent_secret',endpoint:'https://synthetic.invalid',region:'ap-guangzhou',modelId:'service:tencent_tmt',maxTokens:700,timeoutMs:1000}}},
    authorizeConnection:vi.fn(async()=>{}),resolveAsrCredentials:()=>({apiKey:'SYNTHETIC'}),
    resolveTranslationCredentials:()=>({secretId:'SYNTHETIC',secretKey:'SYNTHETIC'}),recordAttempt:async e=>{attempts.push(e);},
    socketFactory:vi.fn(()=>{socket=new SyntheticQwenAsrSocket();socket.model='manual-asr';return socket.asWebSocket();}),fetchFn:vi.fn(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));requests.push(body);
      return new Response(JSON.stringify({Response:{TargetText:body.Target==='zh'?'翻译结果。':'The translated result.',RequestId:'synthetic'}}));
    })};
  const provider=configuredPublicSession(options),events:any[]=[];
  try{
    await provider.createSession(options.session);
    for(const [index,[language,text]] of [['en','Good morning.'],['ja','こんにちは。'],['fr','Bonjour tout le monde.'],['zh','你好，这是中文。']].entries()){
      socket!.language=language;socket!.transcript=text;
      const frame:AudioFrame={type:'audio.frame',sessionId:'session',sequence:index+1,timestampMs:index*100,format:'pcm16',sampleRate:16000,data:Buffer.alloc(3200).toString('base64')};
      markAcceptedAudioRange(frame,{startSample:index*1600,endSample:(index+1)*1600});
      for await(const event of provider.sendAudio(frame))events.push(event);
    }
    for await(const event of provider.flushSession('session',{finishSession:true}))events.push(event);
    expect(events.filter(e=>e.type==='error'||e.type==='translation.failed')).toEqual([]);
    expect(requests.map(r=>[r.Source,r.Target])).toEqual([['en','zh'],['ja','zh'],['fr','zh'],['zh','en']]);
    expect(events.filter(e=>e.type==='transcript.final'&&e.text).map(e=>e.language)).toEqual(['en','ja','fr','zh']);
    expect(options.socketFactory).toHaveBeenCalledTimes(1);
    expect(attempts.filter(e=>e.component==='asr'&&e.state==='confirmed')).toHaveLength(1);
    expect(attempts.filter(e=>e.component==='translation'&&e.state==='confirmed')).toHaveLength(4);
  }finally{await provider.closeSession('session');}
});
