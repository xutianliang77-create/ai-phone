import assert from 'node:assert/strict';
import {it as test} from 'vitest';
import {OpenAiStreamingAsrClient} from './openai-streaming-asr-client.js';
import {SyntheticQwenAsrSocket} from './qwen-streaming-asr.test-support.js';

// Expected product behavior, not assertions that the existing bugs should persist.
// Every provider interaction uses the existing in-process synthetic socket.
function fixture(){
  let socket!:SyntheticQwenAsrSocket;let connections=0;const attempts:any[]=[];
  const client=new OpenAiStreamingAsrClient({sessionId:'test',leaseId:'lease',endpoint:'wss://synthetic.invalid',
    model:'qwen3-asr-flash-realtime',language:'auto',wireProfile:'qwen_asr_realtime',timeoutMs:1000,
    automaticLanguagePair:['zh','en'],automaticSourceLanguages:['zh','en','ja','fr'],
    authorizeConnection:async()=>{},resolveCredentials:()=>({apiKey:'SYNTHETIC_NOT_A_KEY'}),
    record:async event=>{attempts.push({...event});},socketFactory:()=>{
      connections++;
      socket=new SyntheticQwenAsrSocket();socket.model='qwen3-asr-flash-realtime';socket.language='en';
      const original=socket.partial.bind(socket);
      socket.partial=(id,text,stash)=>{const finalLanguage=socket.language;socket.language='en';
        original(id,text,stash);socket.language=finalLanguage;};
      return socket.asWebSocket();
    }});
  return {client,attempts,get socket(){return socket;},get connections(){return connections;}};
}
const session={sessionId:'test',sourceLanguage:'auto' as const,targetLanguage:'en' as const};
const frame=(sequence:number,start:number,samples:number)=>({...session,sequence,timestampMs:start/16,
  format:'pcm16' as const,sampleRate:16000,data:Buffer.alloc(samples*2).toString('base64'),
  acceptedAudioRange:{startSample:start,endSample:start+samples}});

test('CONTROL valid en/ja/fr completed items remain usable',async()=>{
  for(const language of ['en','ja','fr']){
    const f=fixture();await f.client.createSession(session,new AbortController().signal);
    f.socket.language=language;f.socket.transcript='Synthetic reference sentence.';
    try{const result:any=await f.client.transcribe(frame(1,0,1600));
      assert.equal(result.text,'Synthetic reference sentence.');assert.equal(result.language,language);
      assert.equal(f.socket.readyState,1);
    }finally{await f.client.closeSession('test');}
  }
});
test('CONTROL empty text with valid language does not kill the transport',async()=>{
  const f=fixture();await f.client.createSession(session,new AbortController().signal);f.socket.transcript='';
  try{await assert.doesNotReject(()=>f.client.transcribe(frame(1,0,1600)));assert.equal(f.socket.readyState,1);}
  finally{await f.client.closeSession('test');}
});
for(const [label,language] of [['missing',undefined],['null',null]] as const){
  test(`F1 empty completed/${label} language should preserve the ASR session`,async()=>{
    const f=fixture();await f.client.createSession(session,new AbortController().signal);
    f.socket.transcript='';(f.socket as any).language=language;
    try{await assert.doesNotReject(()=>f.client.transcribe(frame(1,0,1600)),
      'Empty ASR text must not be promoted to a transport-wide failure merely because language is absent');
      assert.equal(f.socket.readyState,1);
    }finally{await f.client.closeSession('test');}
  });
}
test('CONTROL nonempty structurally invalid language is not coerced to an authorized language',async()=>{
  const f=fixture();await f.client.createSession(session,new AbortController().signal);
  f.socket.transcript='Nonempty text';(f.socket as any).language={unexpected:'object'};
  try{await assert.rejects(()=>f.client.transcribe(frame(1,0,1600)),(e:any)=>e.code==='qwen_asr_language_invalid');}
  finally{await f.client.closeSession('test');}
});
test('F4 active speech crossing 3600 seconds should not become invalid audio',async()=>{
  const f=fixture();await f.client.createSession(session,new AbortController().signal);let finals=0;
  try{
    for(let i=0;i<120;i++){
      const result=await f.client.transcribe(frame(i+1,i*16000*30,16000*30));
      finals+=Array.isArray(result)?result.length:result?1:0;f.socket.sent.length=0;
    }
    assert.equal(finals,3600,'time-compressed synthetic speech items, not a real 1-hour soak');
    await assert.doesNotReject(()=>f.client.transcribe(frame(121,16000*3600,1600)),
      'The product has no fixed maximum session duration; the next valid 100ms frame must remain usable');
    await f.client.flush({...session,finishSession:true});
    assert.equal(f.connections,1,'Do not rotate to an additional provider connection');
    assert.equal(new Set(f.attempts.map(e=>e.attemptId)).size,1,'Keep one durable ASR attempt');
    assert.equal(f.attempts.at(-1).state,'confirmed');
    assert.equal(f.attempts.at(-1).audioEndSample,3600*16000+1600);
  }finally{await f.client.closeSession('test');}
});
test('long-session support still rejects oversized packets and non-contiguous watermarks',async()=>{
  for(const bad of [frame(2,1599,1600),frame(2,1601,1600),frame(2,1600,16000*30+1)]){
    const f=fixture();await f.client.createSession(session,new AbortController().signal);
    try{await f.client.transcribe(frame(1,0,1600));const before=f.socket.sent.length;
      await assert.rejects(()=>f.client.transcribe(bad),(e:any)=>e.code==='public_asr_stream_audio_invalid');
      assert.equal(f.socket.sent.length,before,'Invalid audio must not reach the provider');
    }finally{await f.client.closeSession('test');}
  }
});
