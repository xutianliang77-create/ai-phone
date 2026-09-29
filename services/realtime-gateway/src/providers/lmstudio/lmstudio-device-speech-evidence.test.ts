import {it,expect,vi} from 'vitest';
import type {ServerRealtimeEvent} from '@translation/contracts';
import {LmStudioRealtimeProvider} from './lmstudio-realtime-provider.js';
import {RealtimeFlushTracker} from '../../connection/realtime-flush-tracker.js';

it.each(['public:tencent','public:qwen','public:openai','public:google'])('same original Provider rejects confirmed non-speech before MT (%s)',async providerName=>{
  const session={sessionId:'s',sourceLanguage:'en' as const,targetLanguage:'zh' as const,voiceOutput:false};
  const translate=vi.fn(async()=> '不得调用'),confirmSpeech=vi.fn(async()=>false);
  const provider=new LmStudioRealtimeProvider({publicSession:session,providerName,baseUrl:'https://synthetic.invalid',model:'synthetic',timeoutMs:500,
    confirmSpeech,translationClient:{supportsAttemptContext:true,translate,healthCheck:async()=>true},
    asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,flush:async()=>null,
      transcribe:async()=>({segmentId:'ghost',revision:1,isFinal:true,text:'Can you book a room.',language:'en' as const,
        timing:{startMs:0,endMs:1000,source:'model' as const}})}});
  const events:ServerRealtimeEvent[]=[],tracker=new RealtimeFlushTracker();
  await provider.createSession(session);
  try{
    for await(const event of provider.sendAudio({type:'audio.frame',sessionId:'s',sequence:1,timestampMs:0,sampleRate:16000,format:'pcm16',data:'AAA='})){events.push(event);tracker.record(event);}
    tracker.beginFinalization();for await(const event of provider.flushSession('s',{finishSession:true}))tracker.record(event);
    expect(events).toEqual([expect.objectContaining({type:'transcript.final',text:'',segmentId:'ghost',revision:1})]);
    expect(translate).not.toHaveBeenCalled();expect(confirmSpeech).toHaveBeenCalledTimes(1);
    expect(tracker.summarize({audioFlushed:true,providerFlushed:true})).toMatchObject({unresolvedSegmentCount:0,translationFailedCount:0});
  }finally{await provider.closeSession('s');}
});
it('a speech-evidence reply after session retirement cannot resurrect a transcript or dispatch MT',async()=>{
  let finish!:(v:boolean)=>void;const pending=new Promise<boolean>(r=>{finish=r;});
  const session={sessionId:'s',sourceLanguage:'en' as const,targetLanguage:'zh' as const,voiceOutput:false},translate=vi.fn(async()=> '不得调用');
  const provider=new LmStudioRealtimeProvider({publicSession:session,baseUrl:'https://synthetic.invalid',model:'synthetic',timeoutMs:500,
    confirmSpeech:()=>pending,translationClient:{translate,healthCheck:async()=>true},
    asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,flush:async()=>null,
      transcribe:async()=>({segmentId:'late',isFinal:true,revision:1,text:'Okay.',language:'en'})}});
  await provider.createSession(session);
  const result=(async()=>{const events=[];for await(const e of provider.sendAudio({type:'audio.frame',sessionId:'s',sequence:1,timestampMs:0,sampleRate:16000,format:'pcm16',data:'AAA='}))events.push(e);return events;})();
  await new Promise(r=>setImmediate(r));await provider.closeSession('s');finish(true);
  expect(await result).toEqual([]);expect(translate).not.toHaveBeenCalled();
});
