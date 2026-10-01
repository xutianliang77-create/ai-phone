import {it,expect,vi} from 'vitest';
import type {DeviceTextLanguageRequest,PublicModelAttemptEvent} from '@translation/contracts';
import {QwenAudioStreamingClient} from './qwen-audio-streaming-client.js';
import {DeviceTextLanguageBroker} from '../connection/device-text-language.js';
import {SyntheticQwenAudioSocket} from './qwen-audio-streaming.test-support.js';
import {realtimeLogger} from '../metrics/realtime-metrics.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(auto=false){
  let socket!:SyntheticQwenAudioSocket;const requests:DeviceTextLanguageRequest[]=[];
  const broker=new DeviceTextLanguageBroker('s',['zh','en','fr','ja'],r=>{requests.push(r);return true;},100);
  const records:PublicModelAttemptEvent[]=[],record=vi.fn(async(e:PublicModelAttemptEvent)=>{records.push(structuredClone(e));});
  const preview=vi.fn(),factory=vi.fn(()=>{socket=new SyntheticQwenAudioSocket();return socket.asWebSocket();});
  const source=auto?'auto' as const:'fr' as const;
  const client=new QwenAudioStreamingClient({sessionId:'s',leaseId:'l',model:'qwen-audio-3.1-asr-flash-streaming',
    endpoint:'wss://synthetic.invalid/api-ws/v1/inference',sampleRate:16000,language:source,timeoutMs:500,
    streaming:{semanticPunctuation:true,heartbeat:true},authorizeConnection:async()=>{},resolveCredentials:()=>({apiKey:'SYNTHETIC'}),
    textLanguage:broker,record,socketFactory:factory,preview});
  const frame=(sequence=0)=>({sessionId:'s',sequence,sourceLanguage:source,targetLanguage:'en' as const,timestampMs:sequence*100,
    format:'pcm16' as const,sampleRate:16000 as const,data:Buffer.alloc(3200).toString('base64'),acceptedAudioRange:{startSample:sequence*1600,endSample:(sequence+1)*1600}});
  const flush={sessionId:'s',sourceLanguage:source,targetLanguage:'en' as const};
  return {client,record,records,preview,requests,broker,factory,frame,flush,get socket(){return socket;},
    start:()=>client.createSession({sessionId:'s',sourceLanguage:source,targetLanguage:'en',asrHotwords:['Qwen3 ASR']},new AbortController().signal)};
}
it('sends new task vocabulary/settings and binary PCM; phone VAD never finishes the supplier task',async()=>{
  const t=setup();try{await t.start();expect(t.factory).not.toHaveBeenCalled();
    await t.client.transcribe(t.frame());
    expect(t.socket.sent[0].payload.parameters).toMatchObject({vocabulary:{'Qwen3 ASR':4},semantic_punctuation_enabled:true,heartbeat:true,language_hints:['fr']});
    t.socket.onAudio=()=>expect(t.records.at(-1)?.state).toBe('dispatching');
    await t.client.commitBoundary({...t.flush,boundaryMs:100});
    expect(t.socket.sent.some(e=>e.header?.action==='finish-task')).toBe(false);
    await t.client.transcribe(t.frame(1));t.socket.sentence(1,'Bonjour tout le monde.');await tick();
    const finals=await t.client.flush({...t.flush,finishSession:true});expect(finals[0]).toMatchObject({language:'fr',text:'Bonjour tout le monde.'});
    expect(t.records.filter(e=>e.state==='dispatching').map(e=>e.audioEndSample)).toEqual([1600,3200]);
    expect(new Set(t.records.map(e=>e.attemptId)).size).toBe(1);expect(t.records.filter(e=>e.state==='confirmed')).toHaveLength(1);
    expect(t.factory).toHaveBeenCalledTimes(1);
  }finally{await t.client.closeSession('s');}
});
it('continues PCM during phone LID and accepts the final reply during end without guessing',async()=>{
  const t=setup(true);try{await t.start();expect(t.factory).not.toHaveBeenCalled();
    await t.client.transcribe(t.frame());expect(t.socket.sent[0].payload.parameters).not.toHaveProperty('language_hints');
    t.socket.sentence(1,'Bonjour tout le monde.',false);t.socket.sentence(1,'Bonjour tout le monde.');
    await t.client.transcribe(t.frame(1));expect(t.socket.bytes).toBe(6400);expect(t.preview).not.toHaveBeenCalled();
    const ending=t.client.flush({...t.flush,finishSession:true});await tick();const {text,audioRange,...r}=t.requests.find(r=>!r.segmentId.endsWith('.preview'))!;
    expect(t.broker.accept({...r,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'fr',hypotheses:{fr:0.99}})).toBe(true);
    const result=await ending;expect(result[0]).toMatchObject({language:'fr',automaticLanguageStatus:'detected'});expect(result[0]).not.toHaveProperty('confidence');
  }finally{await t.client.closeSession('s');}
});
it('records cumulative usage once, ignores repeated final, and preserves unknown original without MT source',async()=>{
  const t=setup(true);try{await t.start();await t.client.transcribe(t.frame());t.socket.sentence(1,'Okay.');t.socket.sentence(1,'Okay.');
    const {text,audioRange,...r}=t.requests[0];t.broker.accept({...r,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'en',hypotheses:{en:0.6,fr:0.4}});
    t.socket.autoFinish=false;const ending=t.client.flush({...t.flush,finishSession:true});await tick();
    t.socket.receive('task-finished',{usage:{input_tokens:10,output_tokens:2,total_tokens:12,duration:0.1}});
    expect(await ending).toEqual([]);expect(t.client.takeLanguageNotices('s')).toEqual([expect.objectContaining({language:'unknown',unconfirmedText:'Okay.'})]);
    expect(t.records.at(-1)?.metadata?.usage).toEqual({promptTokens:10,completionTokens:2,totalTokens:12,audioSeconds:0.1});
    await t.client.closeSession('s');expect(t.records.filter(e=>e.state==='confirmed')).toHaveLength(1);
  }finally{await t.client.closeSession('s');}
});
it('refused growing reservation sends no extra PCM and terminates exactly the prior prefix uncertain',async()=>{
  const t=setup();await t.start();await t.client.transcribe(t.frame());t.record.mockRejectedValueOnce(Error('revoked'));
  await expect(t.client.transcribe(t.frame(1))).rejects.toThrow();expect(t.socket.bytes).toBe(3200);
  expect(t.records.at(-1)).toMatchObject({state:'uncertain',audioEndSample:1600});await t.client.closeSession('s');
});
it('rejects malformed supplier/task events without another socket or model attempt',async()=>{
  const t=setup();await t.start();await t.client.transcribe(t.frame());
  t.socket.emit('message',Buffer.from(JSON.stringify({header:{event:'result-generated',task_id:'foreign'},payload:{}})),false);
  await expect(t.client.flush({...t.flush,finishSession:true})).rejects.toThrow('qwen_audio_event_invalid');
  await t.client.closeSession('s');expect(t.factory).toHaveBeenCalledTimes(1);expect(t.records.at(-1)?.state).toBe('uncertain');
});
it('never retries a terminal write whose acknowledgement is lost and End is bounded',async()=>{
  const t=setup();await t.start();await t.client.transcribe(t.frame());
  t.record.mockImplementationOnce(()=>new Promise<void>(()=>{}));
  await expect(t.client.flush({...t.flush,finishSession:true})).rejects.toThrow('qwen_audio_attempt_record_timeout');
  await expect(t.client.closeSession('s')).rejects.toThrow('qwen_audio_attempt_record_timeout');
  expect(t.record).toHaveBeenCalledTimes(2);expect(t.socket.readyState).toBe(3);
});
it('punctuation-only final withdraws its draft without asking the phone to guess a language',async()=>{
  const t=setup(true);try{await t.start();await t.client.transcribe(t.frame());t.socket.sentence(1,'。');
    expect(await t.client.flush({...t.flush,finishSession:true})).toEqual([]);
    expect(t.requests).toEqual([]);expect(t.client.takeLanguageNotices('s')).toEqual([expect.objectContaining({unconfirmedText:'',discarded:true})]);
  }finally{await t.client.closeSession('s');}
});
it('negative native speech evidence retires the draft before MT without an error or new ASR attempt',async()=>{
  const t=setup(true);try{
    await t.start();await t.client.transcribe(t.frame());
    t.socket.sentence(1,'Can you book a room.',false);t.socket.sentence(1,'Can you book a room.');
    const {text,audioRange,...r}=t.requests.find(r=>!r.segmentId.endsWith('.preview'))!;
    expect(audioRange).toEqual({startSample:0,endSample:1600,sampleRate:16000});
    expect(t.broker.accept({...r,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'en',hypotheses:{en:0.99},
      audioEvidence:{method:'ios_silero_render_v1',range:audioRange,decision:'non_speech',coveredThroughSample:1600,reason:'render_echo'}})).toBe(true);
    expect(await t.client.flush({...t.flush,finishSession:true})).toEqual([]);
    expect(t.client.takeLanguageNotices('s')).toEqual([expect.objectContaining({unconfirmedText:'',discarded:true})]);
    expect(t.records.filter(e=>e.state==='confirmed')).toHaveLength(1);
    expect(t.factory).toHaveBeenCalledTimes(1);
  }finally{await t.client.closeSession('s');}
});

it('does not expose a supplier echo draft before phone speech evidence arrives',async()=>{
  const t=setup(true);try{
    await t.start();await t.client.transcribe(t.frame());
    t.socket.sentence(1,'What are you doing?',false);await tick();
    expect(t.preview).not.toHaveBeenCalled();
    const request=t.requests.find(r=>r.segmentId.endsWith('.preview'));
    expect(request).toBeDefined();
    const {text,audioRange,...r}=request!;
    t.broker.accept({...r,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'en',hypotheses:{en:0.99},
      audioEvidence:{method:'ios_silero_render_v1',range:audioRange,decision:'non_speech',coveredThroughSample:1600,reason:'render_echo'}});
    await tick();expect(t.preview).not.toHaveBeenCalled();
  }finally{await t.client.closeSession('s');}
});

it('publishes genuine near speech but never late or superseded preview evidence',async()=>{
  const t=setup(true);try{
    await t.start();await t.client.transcribe(t.frame());
    t.socket.sentence(1,'Please stop speaking.',false);await tick();
    function acceptLast(){const {text,audioRange,...r}=t.requests.at(-1)!;
      return t.broker.accept({...r,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'en',hypotheses:{en:0.99},
        audioEvidence:{method:'ios_silero_render_v1',range:audioRange,decision:'speech',coveredThroughSample:1600,reason:'speech_overlap'}});}
    expect(acceptLast()).toBe(true);await tick();
    expect(t.preview).toHaveBeenCalledWith(expect.objectContaining({text:'Please stop speaking.',revision:0}));
    t.preview.mockClear();t.socket.sentence(1,'Please stop speaking now.',false);await tick();
    const pending=t.requests.at(-1)!;
    t.socket.sentence(1,'Please stop speaking now.');await tick();
    const {text,audioRange,...r}=pending;
    t.broker.accept({...r,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'en',hypotheses:{en:0.99},
      audioEvidence:{method:'ios_silero_render_v1',range:audioRange,decision:'speech',coveredThroughSample:1600,reason:'speech_overlap'}});
    await tick();expect(t.preview).not.toHaveBeenCalled();
  }finally{await t.client.closeSession('s');}
});
it('preserves an allowlisted provider cause without logging message, transcript or credentials',async()=>{
  const log=vi.spyOn(realtimeLogger,'warn').mockImplementation(()=>{}),t=setup();
  try{await t.start();await t.client.transcribe(t.frame());
    t.socket.emit('message',Buffer.from(JSON.stringify({header:{event:'task-failed',task_id:t.socket.taskId,
      error_code:'InvalidParameter',error_message:'SECRET private words'},payload:{}})),false);
    await expect(t.client.flush({...t.flush,finishSession:true})).rejects.toThrow('qwen_audio_task_failed');
    expect(log).toHaveBeenCalledTimes(1);expect(log.mock.calls[0][0]).toMatchObject({providerErrorCode:'InvalidParameter',origin:'provider_error'});
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  }finally{await t.client.closeSession('s');log.mockRestore();}
});
