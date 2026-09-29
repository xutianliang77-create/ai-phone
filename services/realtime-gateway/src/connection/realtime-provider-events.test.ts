import {afterEach,it,expect,vi} from 'vitest';
import type {ServerRealtimeEvent,PublicRuntimeObservation} from '@translation/contracts';
import type {RealtimeProvider} from '../providers/realtime-provider.js';
import {bindRealtimeProviderEvents} from './realtime-provider-events.js';
import {RealtimeSessionFinalizer} from './realtime-session-finalizer.js';
import {RealtimeFlushTracker} from './realtime-flush-tracker.js';
import {RealtimeEventDispatcher} from './realtime-event-dispatcher.js';
import {bindPublicSessionEventSink} from '../sessions/session-event-sink.js';
import {createSession,deleteSession} from '../sessions/session-manager.js';

const id='fatal-provider-test',binding={sessionId:id,ownerId:'owner',deploymentId:'public',modelPolicyRevision:'p',leaseId:'l',captureId:'c',languagePolicyKey:'lang',sampleRate:16000 as const};
afterEach(()=>deleteSession(id));
function setup(uncertain=false) {
  const session=createSession({sessionId:id,userId:'owner',sourceLanguage:'en',targetLanguage:'zh',voiceOutput:false,planCode:'free',issuedAt:1,expiresAt:9999999999});
  let listener:((event:ServerRealtimeEvent)=>void)|undefined;
  const close=vi.fn(async()=>{}),provider:RealtimeProvider={name:'synthetic',createSession:async()=>{},healthCheck:async()=>true,
    async *sendAudio(){},async *flushSession(){if(uncertain)throw Error('provider_unknown');},closeSession:close,
    setEventListener:(_id,l)=>{listener=l;return()=>{listener=undefined;};}};
  const observations:PublicRuntimeObservation[]=[],base={record:async()=>{},runtime:async(_id:string,e:PublicRuntimeObservation)=>{
    observations.push(e);return{...binding,...e,meterStatus:e.uncertain?'uncertain' as const:'verified' as const};}};
  const sink=bindPublicSessionEventSink(base,binding),tracker=new RealtimeFlushTracker(),client:ServerRealtimeEvent[]=[],errors=vi.fn();
  const dispatcher=new RealtimeEventDispatcher({eventSink:sink,sendClient:e=>client.push(e),afterSend:e=>tracker.record(e),onSyncError:errors});
  const finalizer=new RealtimeSessionFinalizer({sessionId:session.id,provider,audioBatcher:{stopAccepting(){},async flush(){}},
    send:dispatcher.send,drainSessionSync:()=>dispatcher.drain(),flushTracker:tracker,onError:errors,
    confirmed:{beforeFlush:()=>sink.confirmAudio(),freezeMeter:()=>sink.freezeMeter(),stopUncertain:()=>sink.stopUncertain()}});
  const end=vi.fn(async()=>{await finalizer.finalize('connection_error');});
  const unsubscribe=bindRealtimeProviderEvents(provider,id,{isCurrent:()=>true,publicConnection:true,send:dispatcher.send,
    beginFinalization:()=>tracker.beginFinalization(),end,onError:errors});
  const emit=(sessionId=id)=>listener?.({type:'error',sessionId,code:'provider_unavailable',message:'synthetic failure',stage:'asr',retryable:false});
  return {dispatcher,client,end,close,observations,emit,unsubscribe,errors,finalizer};
}
it('provider failure with no next frame freezes the meter, confirms one degraded end and closes once',async()=>{
  const t=setup();t.dispatcher.send({type:'session.started',sessionId:id});await t.dispatcher.drain();
  t.emit();t.emit();await t.finalizer.finalize('client_request');await t.dispatcher.drain();
  expect(t.end).toHaveBeenCalledOnce();expect(t.close).toHaveBeenCalledOnce();
  expect(t.observations.some(e=>e.meterStopped)).toBe(true);expect(t.observations.at(-1)).toMatchObject({phase:'stopped',meterStopped:true});
  expect(t.observations.at(-1)).not.toHaveProperty('uncertain');
  const ended=t.client.filter(e=>e.type==='session.ended');expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({reason:'connection_error',flush:{status:'degraded',pipelineErrorCount:1}});
  t.unsubscribe();
});
it('unknown supplier outcome stops metering and resources without inventing a confirmed end',async()=>{
  const t=setup(true);t.dispatcher.send({type:'session.started',sessionId:id});await t.dispatcher.drain();t.emit();
  await expect(t.finalizer.finalize('client_request')).rejects.toThrow('public_final_flush_unconfirmed');await t.dispatcher.drain();
  expect(t.observations.at(-1)).toMatchObject({phase:'stopped',uncertain:true,meterStopped:true});
  expect(t.client.some(e=>e.type==='session.ended')).toBe(false);expect(t.close).toHaveBeenCalledOnce();t.unsubscribe();
});
it('foreign, retired and private provider callbacks do not terminate a public session',async()=>{
  const t=setup();t.emit('foreign');expect(t.end).not.toHaveBeenCalled();t.unsubscribe();t.emit();expect(t.end).not.toHaveBeenCalled();
  let listener:((e:ServerRealtimeEvent)=>void)|undefined;const provider={setEventListener:(_id:string,l:(e:ServerRealtimeEvent)=>void)=>{listener=l;return()=>{};}} as RealtimeProvider;
  const send=vi.fn(),end=vi.fn();bindRealtimeProviderEvents(provider,id,{isCurrent:()=>true,publicConnection:false,send,beginFinalization:vi.fn(),end,onError:vi.fn()});
  listener?.({type:'error',sessionId:id,code:'provider_unavailable',message:'private',stage:'asr'});expect(send).toHaveBeenCalledOnce();expect(end).not.toHaveBeenCalled();
});
