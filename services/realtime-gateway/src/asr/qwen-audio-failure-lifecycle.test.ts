import {it,expect,vi} from 'vitest';
import {QwenAudioStreamingClient} from './qwen-audio-streaming-client.js';
import {SyntheticQwenAudioSocket} from './qwen-audio-streaming.test-support.js';
import type {PublicModelAttemptEvent} from '@translation/contracts';
import {realtimeLogger} from '../metrics/realtime-metrics.js';

function fixture(rejectSetup=false) {
  let socket!:SyntheticQwenAudioSocket;
  const records:PublicModelAttemptEvent[]=[],notice=vi.fn();
  const record=vi.fn(async(e:PublicModelAttemptEvent)=>{records.push(structuredClone(e));});
  const factory=vi.fn(()=>{
    expect(records.at(-1)).toMatchObject({state:'dispatching',audioEndSample:1600});
    socket=new SyntheticQwenAudioSocket();
    if(rejectSetup){const send=socket.send.bind(socket);socket.send=(data,callback)=>{
      if(typeof data==='string'&&JSON.parse(data).header.action==='run-task'){
        socket.taskId=JSON.parse(data).header.task_id;callback();
        queueMicrotask(()=>socket.emit('message',Buffer.from(JSON.stringify({header:{event:'task-failed',task_id:socket.taskId,
          error_code:'CLIENT_ERROR',error_message:'audio timeout PRIVATE_TOKEN'},payload:{}})),false));return;
      }send(data,callback);
    };}
    return socket.asWebSocket();
  });
  const client=new QwenAudioStreamingClient({sessionId:'s',leaseId:'l',model:'qwen-audio-3.1-asr-flash-streaming',endpoint:'wss://synthetic.invalid/api-ws/v1/inference',
    sampleRate:16000,language:'en',timeoutMs:250,streaming:{semanticPunctuation:true,heartbeat:true},record,socketFactory:factory,
    authorizeConnection:async()=>{},resolveCredentials:()=>({apiKey:'SYNTHETIC'})});
  client.setFailureListener('s',notice);
  const frame={sessionId:'s',sequence:1,timestampMs:1,sourceLanguage:'en' as const,targetLanguage:'zh' as const,format:'pcm16' as const,
    sampleRate:16000 as const,data:Buffer.alloc(3200).toString('base64'),acceptedAudioRange:{startSample:0,endSample:1600}};
  return {client,records,record,factory,notice,frame,get socket(){return socket;},
    start:()=>client.createSession({sessionId:'s',sourceLanguage:'en',targetLanguage:'zh'},new AbortController().signal),
    flush:{sessionId:'s',sourceLanguage:'en' as const,targetLanguage:'zh' as const,finishSession:true}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

it('a microphone failure before first PCM opens no supplier task and ends without an uncertain attempt',async()=>{
  const t=fixture();await t.start();expect(t.factory).not.toHaveBeenCalled();
  expect(await t.client.flush(t.flush)).toEqual([]);await t.client.closeSession('s');
  expect(t.factory).not.toHaveBeenCalled();expect(t.records).toEqual([]);expect(t.notice).not.toHaveBeenCalled();
});
it('first supplier connection waits for the exact audio intent acknowledgement',async()=>{
  const t=fixture();await t.start();let release!:()=>void;
  t.record.mockImplementationOnce(async e=>{await new Promise<void>(r=>{release=r;});t.records.push(e);});
  const append=t.client.transcribe(t.frame);await tick();expect(t.factory).not.toHaveBeenCalled();
  release();await append;expect(t.factory).toHaveBeenCalledOnce();expect(t.socket.bytes).toBe(3200);
  await t.client.flush(t.flush);await t.client.closeSession('s');
});
it('a rejected setup records not_sent once and can confirm a degraded stop',async()=>{
  const log=vi.spyOn(realtimeLogger,'warn').mockImplementation(()=>{}),t=fixture(true);
  try {
    await t.start();await expect(t.client.transcribe(t.frame)).rejects.toThrow('qwen_audio_task_failed');await tick();
    expect(t.notice).toHaveBeenCalledOnce();expect(t.notice).toHaveBeenCalledWith({code:'qwen_audio_task_failed',outcome:'not_sent'});
    expect(await t.client.flush(t.flush)).toEqual([]);await t.client.closeSession('s');
    expect(t.records.map(e=>e.state)).toEqual(['dispatching','not_sent']);expect(t.socket.bytes).toBe(0);expect(t.factory).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({providerErrorCode:'CLIENT_ERROR',providerMessageSignals:['timeout','audio'],providerTaskId:t.socket.taskId});
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_TOKEN');
  } finally { log.mockRestore(); }
});
it('an asynchronous failure after upload notifies without another frame and retains uncertainty',async()=>{
  const t=fixture();await t.start();await t.client.transcribe(t.frame);
  t.socket.emit('message',Buffer.from(JSON.stringify({header:{event:'task-failed',task_id:t.socket.taskId,error_code:'SERVER_ERROR'},payload:{}})),false);
  await tick();expect(t.notice).toHaveBeenCalledOnce();expect(t.notice).toHaveBeenCalledWith({code:'qwen_audio_task_failed',outcome:'uncertain'});
  await expect(t.client.flush(t.flush)).rejects.toThrow('qwen_audio_task_failed');await t.client.closeSession('s');
  expect(t.records.at(-1)?.state).toBe('uncertain');expect(t.socket.readyState).toBe(3);expect(t.factory).toHaveBeenCalledOnce();
});
it('unsubscribed failure notices cannot affect a retired listener',async()=>{
  const t=fixture();await t.start();await t.client.transcribe(t.frame);
  const stale=vi.fn(),unsubscribe=t.client.setFailureListener('s',stale);unsubscribe();t.socket.terminate();await tick();
  expect(stale).not.toHaveBeenCalled();await t.client.closeSession('s');
});
