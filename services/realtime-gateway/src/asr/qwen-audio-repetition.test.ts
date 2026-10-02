import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {PublicModelAttemptEvent} from '@translation/contracts';
import {QwenAudioStreamingClient} from './qwen-audio-streaming-client.js';
import {SyntheticQwenAudioSocket} from './qwen-audio-streaming.test-support.js';
import {DeviceTextLanguageBroker} from '../connection/device-text-language.js';
import {realtimeLogger} from '../metrics/realtime-metrics.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/longrun-repetition-0108.json',import.meta.url),'utf8'));
const raw=fixture.segments[86].text,tick=()=>new Promise(r=>setImmediate(r));
it.each(['auto','zh'] as const)('isolates real anomalous final/partial in %s before LID, keeps one ASR task and continues',async language=>{
  let socket!:SyntheticQwenAudioSocket;
  const requests:any[]=[],records:PublicModelAttemptEvent[]=[],preview=vi.fn();
  const broker=new DeviceTextLanguageBroker('session',['zh','en'],request=>{
    requests.push(request);const{text,audioRange,...binding}=request;
    queueMicrotask(()=>broker.accept({...binding,type:'text.language.result',evidence:'text_only_not_acoustic',dominant:'zh-Hans',hypotheses:{'zh-Hans':0.99}}));return true;
  });
  const factory=vi.fn(()=>{socket=new SyntheticQwenAudioSocket();return socket.asWebSocket();});
  const client=new QwenAudioStreamingClient({sessionId:'session',leaseId:'lease',model:'qwen-audio-3.1-asr-flash-streaming',language,
    endpoint:'wss://synthetic.invalid/api-ws/v1/inference',sampleRate:16000,timeoutMs:1000,streaming:{semanticPunctuation:true,heartbeat:true},
    authorizeConnection:async()=>{},resolveCredentials:()=>({apiKey:'SYNTHETIC'}),record:async e=>{records.push(e);},socketFactory:factory,textLanguage:broker,preview});
  const log=vi.spyOn(realtimeLogger,'warn').mockImplementation(()=>{});
  const frame=(sequence:number)=>({sessionId:'session',sequence,timestampMs:sequence*6000,sourceLanguage:language,targetLanguage:'en' as const,
    format:'pcm16' as const,sampleRate:16000 as const,data:Buffer.alloc(192000).toString('base64'),acceptedAudioRange:{startSample:sequence*96000,endSample:(sequence+1)*96000}});
  const sentence=(id:number,text:string,final:boolean,start=0,end=5760)=>socket.receive('result-generated',{output:{sentence:{sentence_id:id,text,sentence_end:final,begin_time:start,end_time:final?end:null,words:[]}}});
  try{
    await client.createSession({sessionId:'session',sourceLanguage:language,targetLanguage:'en'},new AbortController().signal);
    await client.transcribe(frame(0));
    sentence(1,raw,false);await tick();expect(preview).not.toHaveBeenCalled();expect(requests).toEqual([]);
    sentence(1,raw,true);sentence(1,raw,true);await tick();
    expect(await client.flush({sessionId:'session',sourceLanguage:language,targetLanguage:'en'})).toEqual([]);
    expect(client.takeLanguageNotices('session')).toEqual([{segmentId:socket.taskId+':1',revision:1,language:'unknown',unconfirmedText:'',discarded:true,rejectionReason:'repeated_expansion'}]);
    expect(requests).toEqual([]);expect(await client.healthCheck()).toBe(true);
    await client.transcribe(frame(1));sentence(2,'接下来继续测试。',true,6000,11000);await tick();
    expect(await client.flush({sessionId:'session',sourceLanguage:language,targetLanguage:'en',finishSession:true})).toEqual([expect.objectContaining({text:'接下来继续测试。',language:'zh'})]);
    expect(records.filter(r=>r.state==='confirmed')).toHaveLength(1);expect(new Set(records.map(r=>r.attemptId)).size).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);expect(socket.bytes).toBe(384000);
    expect(log).toHaveBeenCalledTimes(1);expect(JSON.stringify(log.mock.calls)).not.toContain(raw);expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC');
    expect(log.mock.calls[0][0]).toMatchObject({reason:'repeated_expansion',textSha256:fixture.anomalousRawSha256});
  }finally{await client.closeSession('session');log.mockRestore();}
});
