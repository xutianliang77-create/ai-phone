import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {ServerRealtimeEvent} from '@translation/contracts';
import {HttpAsrProvider} from '../asr/http-asr-provider.js';
import {LmStudioRealtimeProvider} from '../providers/lmstudio/lmstudio-realtime-provider.js';
import {RealtimeSessionFinalizer} from './realtime-session-finalizer.js';
import {RealtimeFlushTracker} from './realtime-flush-tracker.js';
import {createSession,deleteSession,getSession} from '../sessions/session-manager.js';
import {claims} from './realtime-session-finalizer.test-support.js';
const row=JSON.parse(readFileSync(new URL('../asr/fixtures/longrun-repetition-0108.json',import.meta.url),'utf8')).segments[86];
it('a quarantined final during End drains and ends exactly once without MT, retry or an unresolved source',async()=>{
  const id='rejected-asr-finalizer';deleteSession(id);createSession({...claims(),sessionId:id,sourceLanguage:'zh',targetLanguage:'en'});
  const session={sessionId:id,sourceLanguage:'zh' as const,targetLanguage:'en' as const,voiceOutput:false};
  const translate=vi.fn(async()=> 'must not be called'),close=vi.fn(async()=>{}),errors=vi.fn();
  const asr=new HttpAsrProvider({endpoint:'https://synthetic.invalid',timeoutMs:100,publicTranscriptIntegrity:true,
    client:{closeSession:close,healthCheck:async()=>true,transcribe:async()=>null,commitBoundary:async()=>null,
      diagnostics:async()=>{throw Error('not_reported');},flush:async()=>({segmentId:'rejected',revision:1,isFinal:true,text:row.text,
        language:'zh',timing:{startMs:row.startMs,endMs:row.endMs,source:'model'}})}});
  const provider=new LmStudioRealtimeProvider({publicSession:session,baseUrl:'https://synthetic.invalid',model:'mock',timeoutMs:100,asrProvider:asr,
    translationClient:{translate,healthCheck:async()=>true}}),events:ServerRealtimeEvent[]=[],tracker=new RealtimeFlushTracker();
  try{
    await provider.createSession(session);
    const finalizer=new RealtimeSessionFinalizer({sessionId:id,provider,
      audioBatcher:{stopAccepting:vi.fn(),flush:async()=>{}},send:e=>{tracker.record(e);events.push(e);},
      drainSessionSync:async()=>{},flushTracker:tracker,onError:errors,confirmed:{beforeFlush:async()=>{}}});
    await Promise.all([finalizer.finalize('client_request'),finalizer.finalize('connection_closed')]);
    expect(events.filter(e=>e.type==='session.ended')).toEqual([expect.objectContaining({flush:expect.objectContaining({status:'degraded',translationFailedCount:1,unresolvedSegmentCount:0,providerFlushed:true})})]);
    expect(events.some(e=>e.type==='error')).toBe(false);expect(translate).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();expect(getSession(id)?.status).toBe('ended');
  }finally{deleteSession(id);}
});
