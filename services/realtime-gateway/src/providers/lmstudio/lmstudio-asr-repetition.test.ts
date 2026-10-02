import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {ServerRealtimeEvent} from '@translation/contracts';
import type {TranscriptResult} from '../../asr/asr-provider.js';
import {HttpAsrProvider} from '../../asr/http-asr-provider.js';
import {LmStudioRealtimeProvider} from './lmstudio-realtime-provider.js';
import {RealtimeTtsOutputQueue} from '../../tts/realtime-tts-output.js';
import {RealtimeFlushTracker} from '../../connection/realtime-flush-tracker.js';
const fixture=JSON.parse(readFileSync(new URL('../../asr/fixtures/longrun-repetition-0108.json',import.meta.url),'utf8'));
const collect=async(g:AsyncGenerator<ServerRealtimeEvent>)=>{const out=[];for await(const e of g)out.push(e);return out;};
const session={sessionId:'repetition',sourceLanguage:'zh' as const,targetLanguage:'en' as const,voiceOutput:true};
const frame={type:'audio.frame' as const,sessionId:session.sessionId,sequence:1,timestampMs:0,format:'pcm16' as const,sampleRate:16000,data:'AAA='};
const row=fixture.segments[86];
const bad:TranscriptResult={segmentId:'bad',revision:1,isFinal:true,text:row.text,language:'zh',timing:{startMs:row.startMs,endMs:row.endMs,source:'model'}};
it.each(['send','flush'] as const)('quarantines recorded repeated expansion from %s before MT/TTS, then continues',async method=>{
  const translate=vi.fn(async()=> 'A normal translation.'),synthesizeStream=vi.fn(async function*(){});
  let results:TranscriptResult[]= [bad];
  const asr=new HttpAsrProvider({endpoint:'https://synthetic.invalid/asr',timeoutMs:100,publicTranscriptIntegrity:true,
    client:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,transcribe:async()=>results,flush:async()=>results,
      commitBoundary:async()=>results,diagnostics:async()=>{throw Error('not_reported');}}});
  const provider=new LmStudioRealtimeProvider({publicSession:session,baseUrl:'https://synthetic.invalid',model:'mock',timeoutMs:100,
    asrProvider:asr,
    translationClient:{translate,healthCheck:async()=>true}});
  const queue=new RealtimeTtsOutputQueue({sessionId:session.sessionId,voiceOutput:true,isSessionActive:()=>true,retireSupersededSegments:true,
    synthesizer:{enabled:true,synthesizeStream,cancelSession:vi.fn(),closeSession:vi.fn()}});
  try{
    await provider.createSession(session);
    const events=await collect(method==='send'?provider.sendAudio(frame):provider.flushSession(session.sessionId,{finishSession:true}));
    expect(translate).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({type:'transcript.final',segmentId:'bad',revision:1,text:''}),
      expect.objectContaining({type:'translation.failed',segmentId:'bad',stage:'asr',retryable:false})]);
    expect(events.some(e=>e.type==='error')).toBe(false);
    const tracker=new RealtimeFlushTracker();tracker.beginFinalization();
    for(const e of events){tracker.record(e);queue.enqueue(e,()=>{});}await queue.drain();
    expect(synthesizeStream).not.toHaveBeenCalled();
    expect(tracker.summarize({audioFlushed:true,providerFlushed:true})).toMatchObject({unresolvedSegmentCount:0,pipelineErrorCount:0});
    results=[{segmentId:'good',revision:1,isFinal:true,text:'接下来继续测试。',language:'zh',timing:{startMs:1415990,endMs:1422390,source:'model'}}];
    const next=await collect(provider.sendAudio({...frame,sequence:2}));
    for(const e of next)queue.enqueue(e,()=>{});await queue.drain();
    expect(translate).toHaveBeenCalledTimes(1);expect(synthesizeStream).toHaveBeenCalledTimes(1);
    expect(next.find(e=>e.type==='translation.final')).toMatchObject({segmentId:'good'});
  }finally{queue.close();await queue.drainInFlight();await provider.closeSession(session.sessionId);}
});

it('replays the 114 saved finals through the original Provider/TTS queue without propagating the one bad result',async()=>{
  const results:TranscriptResult[]=fixture.segments.map((r:any)=>({segmentId:'segment-'+r.ordinal,revision:1,isFinal:true,
    text:r.text,language:'zh',timing:{startMs:r.startMs,endMs:r.endMs,source:'model'}}));
  const translate=vi.fn(async()=> 'Normal output.'),synthesizeStream=vi.fn(async function*(){});
  const asr=new HttpAsrProvider({endpoint:'https://synthetic.invalid/asr',timeoutMs:100,publicTranscriptIntegrity:true,
    client:{closeSession:async()=>{},healthCheck:async()=>true,transcribe:async()=>results.shift()??null,flush:async()=>null,
      commitBoundary:async()=>null,diagnostics:async()=>{throw Error('not_reported');}}});
  const provider=new LmStudioRealtimeProvider({publicSession:session,baseUrl:'https://synthetic.invalid',model:'mock',timeoutMs:100,asrProvider:asr,
    translationClient:{translate,healthCheck:async()=>true}});
  const queue=new RealtimeTtsOutputQueue({sessionId:session.sessionId,voiceOutput:true,isSessionActive:()=>true,retireSupersededSegments:true,
    synthesizer:{enabled:true,synthesizeStream,cancelSession:vi.fn(),closeSession:vi.fn()}}),events:ServerRealtimeEvent[]=[];
  try{
    await provider.createSession(session);
    for(let i=0;i<114;i++){const batch=await collect(provider.sendAudio({...frame,sequence:i}));events.push(...batch);for(const e of batch)queue.enqueue(e,()=>{});await queue.drain();}
    const tail=await collect(provider.flushSession(session.sessionId,{finishSession:true}));events.push(...tail);for(const e of tail)queue.enqueue(e,()=>{});await queue.drain();
    expect(events.filter(e=>e.type==='translation.failed')).toEqual([expect.objectContaining({segmentId:'segment-87',stage:'asr'})]);
    expect(events.filter(e=>e.type==='transcript.final'&&e.text)).toHaveLength(113);
    expect(events.filter(e=>e.type==='translation.final')).toHaveLength(113);
    expect(translate).toHaveBeenCalledTimes(113);expect(synthesizeStream).toHaveBeenCalledTimes(113);
    expect(JSON.stringify(translate.mock.calls)).not.toContain(row.text);
    expect(events.some(e=>e.type==='error')).toBe(false);
  }finally{queue.close();await queue.drainInFlight();await provider.closeSession(session.sessionId);}
});
