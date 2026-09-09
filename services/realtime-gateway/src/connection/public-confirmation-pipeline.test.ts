import {afterEach,describe,it,expect,vi} from "vitest";
import type {AudioFrame,PublicRuntimeObservation,ServerRealtimeEvent} from "@translation/contracts";
import {RealtimeEventDispatcher} from "./realtime-event-dispatcher.js";
import {AudioFrameBatcher} from "./audio-frame-batcher.js";
import {RealtimeSessionFinalizer} from "./realtime-session-finalizer.js";
import {RealtimeFlushTracker} from "./realtime-flush-tracker.js";
import {bindPublicSessionEventSink} from "../sessions/session-event-sink.js";
import {createSession,deleteSession} from "../sessions/session-manager.js";
import type {RealtimeProvider} from "../providers/realtime-provider.js";
const binding={sessionId:"confirm-test",ownerId:"owner",deploymentId:"public-test",modelPolicyRevision:"p",
  leaseId:"lease",captureId:"capture",languagePolicyKey:"lang:1",sampleRate:16000 as const};
const started={type:"session.started",sessionId:binding.sessionId} as const;
const ended={type:"session.ended",sessionId:binding.sessionId,reason:"client_request"} as const;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function setup(){
  const base={record:vi.fn(async(_e:ServerRealtimeEvent)=>{}),touch:vi.fn(),
    runtime:vi.fn(async(_id:string,e:PublicRuntimeObservation)=>({...binding,...e,meterStatus:"verified" as const}))};
  const sink=bindPublicSessionEventSink(base,binding),sendClient=vi.fn(),afterSend=vi.fn(),errors=vi.fn();
  const dispatcher=new RealtimeEventDispatcher({eventSink:sink,sendClient,afterSend,onSyncError:errors});
  return {base,sink,dispatcher,sendClient,afterSend,errors};
}
afterEach(()=>deleteSession(binding.sessionId));
describe("public confirmation in the original Gateway pipeline",()=>{
  it.each(["session.started","session.paused","session.resumed","session.ended"] as const)(
    "does not notify %s before persistence confirms",async type=>{
      const {base,dispatcher,sendClient}=setup();
      if(type!=="session.started"){dispatcher.send(started);await dispatcher.drain();}
      if(type==="session.resumed"){dispatcher.send({type:"session.paused",sessionId:binding.sessionId});await dispatcher.drain();}
      sendClient.mockClear();const hold=deferred();
      base.runtime.mockImplementationOnce(async(_id,e)=>{await hold.promise;return {...binding,...e,meterStatus:"verified"};});
      const event=type==="session.ended"?ended:{type,sessionId:binding.sessionId};
      dispatcher.send(event);await Promise.resolve();expect(sendClient).not.toHaveBeenCalled();
      hold.resolve();await dispatcher.drain();expect(sendClient).toHaveBeenCalledWith(event);
    });
  it("surfaces durable failure from drain and never reports successful public end",async()=>{
    const {base,dispatcher,sendClient,errors}=setup();dispatcher.send(started);await dispatcher.drain();sendClient.mockClear();
    base.runtime.mockRejectedValueOnce(Error("lost acknowledgement"));dispatcher.send(ended);
    await expect(dispatcher.drain()).rejects.toThrow();expect(sendClient).not.toHaveBeenCalled();expect(errors).toHaveBeenCalledTimes(1);
    dispatcher.send({type:"session.resumed",sessionId:binding.sessionId});expect(sendClient).not.toHaveBeenCalled();
  });
  it("suppresses a late start confirmation after end has been requested",async()=>{
    const {base,dispatcher,sendClient}=setup();const hold=deferred();
    base.runtime.mockImplementationOnce(async(_id,e)=>{await hold.promise;return {...binding,...e,meterStatus:"verified"};});
    dispatcher.send(started);dispatcher.send(ended);hold.resolve();await dispatcher.drain();
    expect(sendClient.mock.calls.map(c=>c[0].type)).toEqual(["session.ended"]);
  });
  it("keeps private best-effort notification and drain semantics unchanged",async()=>{
    const sendClient=vi.fn(),errors=vi.fn();const dispatcher=new RealtimeEventDispatcher({
      eventSink:{record:async()=>{throw Error("private sync failure");}},sendClient,afterSend:vi.fn(),onSyncError:errors});
    dispatcher.send(started);expect(sendClient).toHaveBeenCalledWith(started);await dispatcher.drain();expect(errors).toHaveBeenCalled();
  });
  it("gates actual AudioFrameBatcher input on confirmed runtime and keeps rejected frames out of the provider",async()=>{
    const {base,sink,dispatcher}=setup();const hold=deferred();
    base.runtime.mockImplementationOnce(async(_id,e)=>{await hold.promise;return {...binding,...e,meterStatus:"verified"};});
    const audio:AudioFrame[]=[],errors:unknown[]=[];
    const provider={async *sendAudio(frame:AudioFrame){audio.push(frame);}} as RealtimeProvider;
    const batcher=new AudioFrameBatcher({sessionId:binding.sessionId,provider,send:dispatcher.send,
      acceptFrame:sink.acceptAudio.bind(sink),onError:e=>errors.push(e),batchDelayMs:60000});
    const frame=(sequence:number):AudioFrame=>({type:"audio.frame",sessionId:binding.sessionId,sequence,timestampMs:999999,
      sampleRate:16000,format:"pcm16",data:Buffer.alloc(320).toString("base64")});
    try {
      dispatcher.send(started);batcher.enqueue(frame(1));await batcher.flush();expect(audio).toEqual([]);
      hold.resolve();await dispatcher.drain();
      const accepted=frame(1);batcher.enqueue(accepted);accepted.data="mutated";
      batcher.enqueue(frame(1));batcher.enqueue({...frame(2),sessionId:"other"});await batcher.flush();
      expect(audio).toHaveLength(1);expect(audio[0].data).toBe(frame(1).data);
      expect(batcher.diagnostics().receivedFrameCount).toBe(1);expect(errors).toHaveLength(2);
      dispatcher.send(ended);await dispatcher.drain();batcher.enqueue(frame(2));await batcher.flush();expect(audio).toHaveLength(1);
      expect(base.runtime.mock.calls.at(-1)![1].lastAcceptedSample).toBe(160);
    }finally{await batcher.close();}
  });
  it("closes the original provider if durable drain fails during final flush",async()=>{
    const {base,dispatcher,sendClient}=setup();dispatcher.send(started);await dispatcher.drain();sendClient.mockClear();
    createSession({sessionId:binding.sessionId,userId:"owner",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,
      planCode:"free",maxDurationSeconds:120,issuedAt:1,expiresAt:9999999999});
    base.record.mockRejectedValueOnce(Error("storage failure"));const close=vi.fn(async()=>{});
    const provider={name:"synthetic",closeSession:close,async *flushSession(){yield {type:"transcript.final" as const,
      sessionId:binding.sessionId,segmentId:"s",text:"hello",language:"en" as const};}} as RealtimeProvider;
    const stop=vi.fn();const finalizer=new RealtimeSessionFinalizer({sessionId:binding.sessionId,provider,
      audioBatcher:{stopAccepting:stop,flush:async()=>{}},send:dispatcher.send,drainSessionSync:()=>dispatcher.drain(),
      flushTracker:new RealtimeFlushTracker(),onError:vi.fn()});
    await expect(finalizer.finalize("client_request")).rejects.toThrow();
    expect(stop).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
    expect(sendClient.mock.calls.some(c=>c[0].type==="session.ended")).toBe(false);
  });
});
