import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {HttpAsrProvider} from './http-asr-provider.js';
import type {TranscriptResult} from './asr-provider.js';
const row=JSON.parse(readFileSync(new URL('./fixtures/longrun-repetition-0108.json',import.meta.url),'utf8')).segments[86];
const bad:TranscriptResult={segmentId:'bad',revision:1,isFinal:true,text:row.text,language:'zh',timing:{startMs:row.startMs,endMs:row.endMs,source:'model'}};
const session={sessionId:'session',sourceLanguage:'zh' as const,targetLanguage:'en' as const};
const frame={type:'audio.frame' as const,sessionId:'session',sequence:0,timestampMs:0,format:'pcm16' as const,sampleRate:16000,data:'AAA='};
function setup(enabled?:boolean){
  let partial:(r:TranscriptResult)=>void=()=>{};
  const client={closeSession:vi.fn(async()=>{}),healthCheck:async()=>true,transcribe:vi.fn(async()=>bad),flush:vi.fn(async()=>bad),
    commitBoundary:vi.fn(async()=>bad),diagnostics:async()=>{throw Error('not_reported');},
    setPartialListener:(_s:string,l:(r:TranscriptResult)=>void)=>{partial=l;return ()=>{};}};
  const provider=new HttpAsrProvider({endpoint:'https://synthetic.invalid',timeoutMs:100,publicTranscriptIntegrity:enabled,client});
  return {provider,client,partial:(r:TranscriptResult)=>partial(r)};
}
it.each(['transcribe','flush','commit'] as const)('filters all original public result entrances including %s',async method=>{
  const t=setup(true);await t.provider.createSession(session);
  try{
    const out=await(method==='transcribe'?t.provider.transcribe(frame):method==='flush'?t.provider.flush('session',{finishSession:true}):t.provider.commitBoundary({sessionId:'session',boundaryMs:5760}));
    expect(out).toBeNull();expect(t.provider.takeLanguageNotices('session')).toEqual([expect.objectContaining({segmentId:'bad',rejectionReason:'repeated_expansion',discarded:true})]);
    expect(t.provider.takeLanguageNotices('session')).toEqual([]);
  }finally{await t.provider.closeSession('session');}
});
it('leaves the frozen private default untouched and does not block a well-timed long result',async()=>{
  const legacy=setup();await legacy.provider.createSession(session);
  expect(await legacy.provider.transcribe(frame)).toEqual(bad);expect(legacy.provider.takeLanguageNotices('session')).toEqual([]);await legacy.provider.closeSession('session');
  const current=setup(true);await current.provider.createSession(session);
  current.client.transcribe.mockResolvedValue({...bad,timing:{startMs:0,endMs:60000,source:'model'}});
  expect(await current.provider.transcribe(frame)).toMatchObject({text:bad.text});await current.provider.closeSession('session');
});
it('withholds anomalous asynchronous drafts but forwards normal partials unchanged',async()=>{
  const t=setup(true),listener=vi.fn();await t.provider.createSession(session);t.provider.setPartialListener('session',listener);
  try{t.partial({...bad,isFinal:false});expect(listener).not.toHaveBeenCalled();
    const good={...bad,text:'你好。',isFinal:false};t.partial(good);expect(listener).toHaveBeenCalledWith(good);
  }finally{await t.provider.closeSession('session');}
});
it('clears rejected notices on close and never inherits them in a new session',async()=>{
  const t=setup(true);await t.provider.createSession(session);await t.provider.transcribe(frame);await t.provider.closeSession('session');
  expect(t.provider.takeLanguageNotices('session')).toEqual([]);await t.provider.createSession(session);expect(t.provider.takeLanguageNotices('session')).toEqual([]);await t.provider.closeSession('session');
});
