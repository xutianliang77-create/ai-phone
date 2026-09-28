import {describe,expect,it,vi} from 'vitest';
import type {ServerRealtimeEvent} from '@translation/contracts';
import type {TranscriptResult} from '../../asr/asr-provider.js';
import {LmStudioRealtimeProvider} from './lmstudio-realtime-provider.js';
import {RealtimeFlushTracker} from '../../connection/realtime-flush-tracker.js';
import {RealtimeTtsOutputQueue} from '../../tts/realtime-tts-output.js';
const collect=async(g:AsyncGenerator<ServerRealtimeEvent>)=>{const out=[];for await(const e of g)out.push(e);return out;};
const session={sessionId:'punctuation',sourceLanguage:'zh' as const,targetLanguage:'en' as const,voiceOutput:true};
const frame={type:'audio.frame' as const,sessionId:session.sessionId,sequence:1,timestampMs:1,format:'pcm16' as const,sampleRate:16000,data:'AAA='};
describe('punctuation final on the original Provider, flush and TTS paths',()=>{
  it('marks punctuation-only MT output failed while retaining the real original',async()=>{
    const provider=new LmStudioRealtimeProvider({publicSession:session,baseUrl:'https://synthetic.invalid',model:'test',timeoutMs:100,
      asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,transcribe:async()=>({segmentId:'real',text:'你好。',language:'zh',revision:1,isFinal:true}),flush:async()=>null},
      translationClient:{translate:async()=> '。',healthCheck:async()=>true}});
    try{
      await provider.createSession(session);const events=await collect(provider.sendAudio(frame));
      expect(events.map(e=>e.type)).toEqual(['transcript.final','translation.failed']);
      expect(events[0]).toMatchObject({text:'你好。',segmentId:'real'});
    }finally{await provider.closeSession(session.sessionId);}
  });
  it.each(['send','flush'] as const)('retracts a draft without MT or TTS from %s',async method=>{
    const final:TranscriptResult={segmentId:'punctuation-only',text:'。',language:'zh',revision:1,isFinal:true};
    const translate=vi.fn(async()=>'.'),synthesizeStream=vi.fn(async function*(){});
    const provider=new LmStudioRealtimeProvider({publicSession:session,baseUrl:'https://synthetic.invalid',model:'test',timeoutMs:100,
      asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,transcribe:async()=>final,flush:async()=>final},
      translationClient:{translate,healthCheck:async()=>true}});
    const tracker=new RealtimeFlushTracker(),queue=new RealtimeTtsOutputQueue({sessionId:session.sessionId,voiceOutput:true,isSessionActive:()=>true,
      synthesizer:{enabled:true,synthesizeStream,cancelSession:vi.fn(),closeSession:vi.fn()}});
    try{
      await provider.createSession(session);
      const events=await collect(method==='send'?provider.sendAudio(frame):provider.flushSession(session.sessionId,{finishSession:true}));
      expect(events).toEqual([{type:'transcript.final',sessionId:session.sessionId,segmentId:final.segmentId,turnId:undefined,revision:1,text:'',language:'zh'}]);
      tracker.beginFinalization();
      for(const e of events){tracker.record(e);queue.enqueue(e,()=>{});}await queue.drain();
      expect(tracker.summarize({audioFlushed:true,providerFlushed:true})).toMatchObject({status:'empty',unresolvedSegmentCount:0,translationFinalCount:0});
      expect(translate).not.toHaveBeenCalled();expect(synthesizeStream).not.toHaveBeenCalled();
    }finally{queue.close();await queue.drainInFlight();await provider.closeSession(session.sessionId);}
  });
});
