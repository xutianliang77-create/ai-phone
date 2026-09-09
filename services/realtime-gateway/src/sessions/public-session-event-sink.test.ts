import {describe,it,expect,vi} from "vitest";
import type {AudioFrame,PublicRuntimeObservation,ServerRealtimeEvent} from "@translation/contracts";
import {bindPublicSessionEventSink} from "./session-event-sink.js";
const binding={sessionId:"s",ownerId:"owner",deploymentId:"public-test",modelPolicyRevision:"policy-v1",
  leaseId:"lease",captureId:"capture",languagePolicyKey:"policy:1",sampleRate:16000 as const};
const frame=(sequence=0):AudioFrame=>({type:"audio.frame",sessionId:"s",format:"pcm16",sampleRate:16000,
  data:Buffer.alloc(320).toString("base64"),sequence,timestampMs:999999});
const end={type:"session.ended",sessionId:"s",reason:"user_request",billableSeconds:999999} as ServerRealtimeEvent;
function fixture(){
  const events:unknown[]=[];
  const base={record:vi.fn(async(e:ServerRealtimeEvent)=>{events.push(e);}),touch:vi.fn(),
    runtime:vi.fn(async(_id:string,e:PublicRuntimeObservation)=>{
      events.push(e);return {...binding,...e,meterStatus:"verified" as const};
    })};
  return {base,events,sink:bindPublicSessionEventSink(base,binding)};
}
describe("public branch of original session sink",()=>{
  it("confirms the phase at queue execution, not the stale phase before a pending pause",async()=>{
    const {sink,events}=fixture();await sink.record({type:"session.started",sessionId:"s"});sink.acceptAudio(frame());
    const pause=sink.record({type:"session.paused",sessionId:"s"});const confirm=sink.confirmAudio();await Promise.all([pause,confirm]);
    expect(events.at(-1)).toMatchObject({phase:"paused",lastAcceptedSample:160});
  });
  it("does not persist draft partials or treat boundary ACKs as model work",async()=>{
    const {sink,base}=fixture();await sink.record({type:"session.started",sessionId:"s"});
    await sink.record({type:"transcript.partial",sessionId:"s",segmentId:"draft",revision:0,text:"Bonjour",language:"fr"});
    await sink.record({type:"audio.boundary.committed",sessionId:"s",sequence:1});expect(base.record).not.toHaveBeenCalled();
  });
  it("serializes start, accepted PCM, committed text, pause, resume and stop without legacy billing",async()=>{
    const {sink,events,base}=fixture();await sink.record({type:"session.started",sessionId:"s"});
    sink.acceptAudio(frame());
    const text=sink.record({type:"transcript.final",sessionId:"s",segmentId:"seg",text:"你好",language:"zh",revision:3});
    const pause=sink.record({type:"session.paused",sessionId:"s"});await Promise.all([text,pause]);
    expect(()=>sink.acceptAudio(frame(1))).toThrow("not_active");
    await sink.record({type:"session.resumed",sessionId:"s"});sink.acceptAudio(frame(1));
    await sink.touch("s","active");const first=sink.record(end);expect(sink.record(end)).toBe(first);await first;await sink.drain();
    expect(events).toEqual([
      expect.objectContaining({sequence:1,phase:"active",lastAcceptedSample:0,finalRevision:0}),
      expect.objectContaining({type:"transcript.final"}),
      expect.objectContaining({sequence:2,phase:"paused",lastAcceptedSample:160,finalRevision:3}),
      expect.objectContaining({sequence:3,phase:"active"}),expect.objectContaining({sequence:4,phase:"active"}),
      expect.objectContaining({sequence:5,phase:"stopped",lastAcceptedSample:320,finalRevision:3}),
    ]);
    expect(base.touch).not.toHaveBeenCalled();expect(base.record).toHaveBeenCalledTimes(1);
    expect(events.filter(e=>"phase" in (e as object)).every(e=>!("billableSeconds" in (e as object)))).toBe(true);
    expect(()=>sink.acceptAudio(frame(2))).toThrow("stopped");
    await expect(sink.record({type:"session.started",sessionId:"s"})).rejects.toThrow("stopped");
  });
  it("freezes queued text, and waits for persistence before sealing the revision",async()=>{
    const {base,sink}=fixture();await sink.record({type:"session.started",sessionId:"s"});await sink.drain();
    let release!:()=>void;base.record.mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));
    const event={type:"transcript.final" as const,sessionId:"s",segmentId:"seg",text:"hello",language:"en" as const,revision:2};
    const pending=sink.record(event);event.revision=999;event.text="mutated";
    const stopped=sink.record(end);await Promise.resolve();
    expect(base.runtime).toHaveBeenCalledTimes(1);release();await Promise.all([pending,stopped]);
    expect(base.record.mock.calls[0][0]).toMatchObject({text:"hello",revision:2});
    expect(base.runtime.mock.calls.at(-1)![1].finalRevision).toBe(2);
  });
  it.each([{ownerId:"other"},{deploymentId:"other"},{modelPolicyRevision:"other"},{sequence:20},
    {lastAcceptedSample:999},{meterStatus:"uncertain"}])("halts after an invalid/uncertain receipt %j",async patch=>{
    const {sink,base}=fixture();base.runtime.mockImplementationOnce(async(_id,e)=>({...binding,...e,...patch}) as never);
    await expect(sink.record({type:"session.started",sessionId:"s"})).rejects.toThrow("unconfirmed");
    await expect(sink.touch("s","active")).rejects.toThrow();await expect(sink.record(end)).rejects.toThrow();
    expect(base.runtime).toHaveBeenCalledTimes(1);expect(base.record).not.toHaveBeenCalled();
  });
  it("does not send stop after text persistence failure",async()=>{
    const {sink,base}=fixture();await sink.record({type:"session.started",sessionId:"s"});
    base.record.mockRejectedValueOnce(Error("storage failure"));
    const data=sink.record({type:"translation.final",sessionId:"s",segmentId:"seg",text:"hello",language:"en",revision:1});
    const stop=sink.record(end);await expect(data).rejects.toThrow();await expect(stop).rejects.toThrow();
    expect(base.runtime).toHaveBeenCalledTimes(1);await expect(sink.drain()).rejects.toThrow();
  });
  it("rejects wrong session, repeated/invalid PCM and does not trust the timestamp",async()=>{
    const {sink,base}=fixture();await sink.record({type:"session.started",sessionId:"s"});sink.acceptAudio(frame());
    for(const f of [frame(),{...frame(1),sessionId:"other"},{...frame(1),sampleRate:24000 as const},
      {...frame(1),data:"bad="}])expect(()=>sink.acceptAudio(f)).toThrow();
    await expect(sink.touch("other","active")).rejects.toThrow("session_mismatch");
    await sink.record(end);expect(base.runtime.mock.calls.at(-1)![1].lastAcceptedSample).toBe(160);
  });
  it("anchors duplicate disconnects and prevents heartbeat from silently resuming",async()=>{
    const {sink,base}=fixture();await sink.record({type:"session.started",sessionId:"s"});
    await sink.disconnect();await sink.disconnect();expect(base.runtime).toHaveBeenCalledTimes(2);
    await expect(sink.touch("s","active")).rejects.toThrow("phase_mismatch");
    expect(base.runtime).toHaveBeenCalledTimes(2);
  });
  it("requires a real runtime transport instead of a noop sink",()=>{
    expect(()=>bindPublicSessionEventSink({record:vi.fn(),touch:vi.fn()},binding)).toThrow("sink_required");
  });
  it("bounds queued persistence and fails closed on overflow",async()=>{
    const {sink,base}=fixture();await sink.record({type:"session.started",sessionId:"s"});await sink.drain();
    let release!:()=>void;base.record.mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));
    const first=sink.record({type:"transcript.final",sessionId:"s",segmentId:"seg",text:"hello",language:"en"});
    await Promise.resolve();
    const queued=Array.from({length:33},()=>sink.touch("s","active").catch(()=>undefined));
    release();await Promise.all([first,...queued]);await expect(sink.drain()).rejects.toThrow("queue_full");
    expect(base.runtime).toHaveBeenCalledTimes(1);
  });
});
