import {afterEach,describe,it,expect,vi} from "vitest";
import type {AudioFrame} from "@translation/contracts";
import {ProviderRouter} from "../providers/provider-router.js";
import type {ConfiguredStreamingAsrOptions} from "./configured-public-asr.js";
import {HttpAsrProvider} from "./http-asr-provider.js";
import {SyntheticAsrSocket} from "./streaming-asr.test-support.js";
import {LmStudioRealtimeProvider} from "../providers/lmstudio/lmstudio-realtime-provider.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";
const session={sessionId:"stream",sourceLanguage:"fr" as const,targetLanguage:"ja" as const};
const frame=(n=1):AudioFrame=>{const f:AudioFrame={type:"audio.frame",sessionId:"stream",sequence:n,timestampMs:1788883200000+(n-1)*100,format:"pcm16",sampleRate:24000,data:Buffer.alloc(4800).toString("base64")};
  markAcceptedAudioRange(f,{startSample:(n-1)*2400,endSample:n*2400});return f;};
const active:HttpAsrProvider[]=[];
function setup(configure?:(ws:SyntheticAsrSocket)=>void){
  const sockets:SyntheticAsrSocket[]=[],record=vi.fn(async()=>{}),authorizeConnection=vi.fn(async()=>{}),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_KEY"}));
  const socketFactory=vi.fn((_url:string,_options:unknown)=>{const ws=new SyntheticAsrSocket();configure?.(ws);sockets.push(ws);return ws.asWebSocket();});
  const plan={asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}} as const;
  const options:ConfiguredStreamingAsrOptions={deploymentId:"public-test",sessionId:"stream",leaseId:"lease",socketFactory,record,authorizeConnection,resolveCredentials,
    snapshot:{deploymentId:"public-test",configurationRevision:1,modelPolicyRevision:"p",executionPlan:plan,components:{asr:{enabled:true,vendor:"openai",protocol:"openai_realtime_asr",authKind:"api_key",endpoint:"wss://synthetic.invalid/v1/realtime",modelId:"chosen-asr",timeoutMs:500,sampleRate:24000}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"p",languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},executionPlan:plan,syncPermission:{allowed:false}}};
  const create=()=>{const p=new ProviderRouter().createConfiguredStreamingAsrProvider(options);active.push(p);return p;};
  return {options,create,sockets,record,authorizeConnection,resolveCredentials,socketFactory};
}
afterEach(async()=>{for(const p of active.splice(0))await p.closeSession("stream");vi.restoreAllMocks();vi.useRealTimers();});
describe("streaming ASR transport injected into original Provider",()=>{
  it("waits for exact configuration ACK and sends ASR-only updates with selected model/language",async()=>{
    const s=setup(),p=s.create();expect(p).toBeInstanceOf(HttpAsrProvider);await p.createSession(session);
    const [url,options]=s.socketFactory.mock.calls[0];expect(new URL(url).searchParams.get("model")).toBe("chosen-asr");expect((options as any).headers.Authorization).toBe("Bearer SYNTHETIC_KEY");
    expect(s.sockets[0].sent).toEqual([{type:"session.update",session:{type:"transcription",audio:{input:{format:{type:"audio/pcm",rate:24000},transcription:{model:"chosen-asr",language:"fr"},turn_detection:null}}}}]);
    expect(await p.healthCheck()).toBe(false);expect(s.record).not.toHaveBeenCalled();
  });
  it("uploads growing prefixes only after durable intent, then explicitly commits one turn",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);s.sockets[0].onSend=e=>{if(e.type==="input_audio_buffer.append")expect(s.record.mock.calls.length).toBeGreaterThan(0);};
    expect(await p.transcribe(frame())).toBeNull();await p.transcribe(frame(2));expect(s.sockets[0].sent.map(e=>e.type)).not.toContain("input_audio_buffer.commit");
    const result=await p.commitBoundary({sessionId:"stream",boundaryMs:200});expect(result).toMatchObject({text:"Bonjour",language:"fr",isFinal:true,timing:{startMs:0,endMs:200}});
    const events=s.record.mock.calls.map(c=>(c as any)[0]);expect(events.map(e=>e.audioEndSample)).toEqual([2400,4800,4800,4800]);expect(new Set(events.map(e=>e.attemptId)).size).toBe(1);
    expect(events.map(e=>e.state)).toEqual(["dispatching","dispatching","dispatching","confirmed"]);expect(events[3].metadata.usage.audioSeconds).toBe(0.2);
    expect(await p.flush("stream")).toBeNull();expect(JSON.stringify(events)).not.toContain("Bonjour");
  });
  it("feeds confirmed ASR through the original realtime translation Provider",async()=>{
    const s=setup(),asr=s.create(),translate=vi.fn(async()=>"こんにちは");
    const provider=new LmStudioRealtimeProvider({baseUrl:"https://unused.invalid",model:"chosen-mt",timeoutMs:500,asrProvider:asr,translationClient:{translate,healthCheck:async()=>false}});
    await provider.createSession({...session,voiceOutput:false});for await(const _e of provider.sendAudio(frame())){}for await(const _e of provider.sendAudio(frame(2))){}
    expect(translate).not.toHaveBeenCalled();const events=[];for await(const e of provider.flushSession("stream"))events.push(e);
    expect(events.some(e=>e.type==="transcript.final")).toBe(true);expect(translate).toHaveBeenCalledTimes(1);await provider.closeSession("stream");
  });
  it("uses plural language hints for the documented live-transcribe wire family",async()=>{
    const s=setup();s.options.snapshot.components.asr!.modelId="gpt-live-transcribe";await s.create().createSession(session);
    expect(s.sockets[0].sent[0].session.audio.input.transcription).toEqual({model:"gpt-live-transcribe",languages:["fr"]});
  });
  it.each(["auth","credentials"])("does not connect after %s failure",async kind=>{
    const s=setup();if(kind==="auth")s.authorizeConnection.mockRejectedValue(Error("SECRET"));else s.resolveCredentials.mockRejectedValue(Error("SECRET"));
    await expect(s.create().createSession(session)).rejects.toMatchObject({outcome:"not_sent"});expect(s.socketFactory).not.toHaveBeenCalled();
  });
  it("does not upload before session.updated and times out an unacknowledged setup",async()=>{
    vi.useFakeTimers();const s=setup(ws=>ws.autoSetup=false),p=s.create(),check=expect(p.createSession(session)).rejects.toMatchObject({outcome:"not_sent"});
    await vi.advanceTimersByTimeAsync(501);await check;expect(s.sockets[0].readyState).toBe(3);expect(s.sockets[0].sent).toHaveLength(1);
  });
  it("rejects wrong model in server ACK",async()=>{
    const s=setup(ws=>{ws.autoSetup=false;ws.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>{const session=structuredClone(e.session);session.audio.input.transcription.model="wrong";ws.receive({type:"session.updated",session});});};});
    await expect(s.create().createSession(session)).rejects.toMatchObject({outcome:"not_sent"});expect(s.sockets[0].readyState).toBe(3);
  });
  it.each([{sampleRate:16000},{sequence:-1},{timestampMs:-1},{data:"invalid"},{sessionId:"wrong"}])("rejects wrong or discontinuous audio before append",async patch=>{
    const s=setup(),p=s.create();await p.createSession(session);await expect(p.transcribe({...frame(),...patch} as AudioFrame)).rejects.toThrow();expect(s.sockets[0].sent).toHaveLength(1);
  });
  it("blocks append and commit after evidence revocation",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());s.record.mockRejectedValue(Error("revoked"));
    await expect(p.flush("stream")).rejects.toMatchObject({outcome:"uncertain"});expect(s.sockets[0].sent.map(e=>e.type)).not.toContain("input_audio_buffer.commit");
  });
  it("does not send the next prefix after its record fails",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());s.record.mockRejectedValue(Error("db"));await expect(p.transcribe(frame(2))).rejects.toThrow();
    expect(s.sockets[0].sent.filter(e=>e.type==="input_audio_buffer.append")).toHaveLength(1);
  });
  it("close interrupts a pending commit, records uncertainty and never accepts a late transcript",async()=>{
    const s=setup(ws=>ws.autoComplete=false),p=s.create();await p.createSession(session);await p.transcribe(frame());
    let entered!:()=>void;const committed=new Promise<void>(r=>entered=r);s.sockets[0].onSend=e=>{if(e.type==="input_audio_buffer.commit")entered();};
    const pending=p.flush("stream"),check=expect(pending).rejects.toMatchObject({outcome:"uncertain"});await committed;await p.closeSession("stream");await check;
    s.sockets[0].receive({type:"conversation.item.input_audio_transcription.completed",item_id:"late",content_index:0,transcript:"late"});
    expect((s.record.mock.calls.at(-1) as any)[0].state).toBe("uncertain");
  });
  it("close never commits pending audio",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());await p.closeSession("stream");
    expect(s.sockets[0].sent.map(e=>e.type)).not.toContain("input_audio_buffer.commit");expect((s.record.mock.calls.at(-1) as any)[0].state).toBe("uncertain");
  });
  it("supports consecutive non-overlapping turns and ignores completed-item replay",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());const first=await p.flush("stream");
    await p.transcribe(frame(2));s.sockets[0].receive({type:"conversation.item.input_audio_transcription.completed",item_id:"item-1",content_index:0,transcript:"OLD"});
    const second=await p.flush("stream");expect(second?.segmentId).not.toBe(first?.segmentId);expect(second?.text).toBe("Bonjour");
    expect((s.record.mock.calls.at(-1) as any)[0]).toMatchObject({audioStartSample:2400,audioEndSample:4800});
  });
  it("requires an endpoint at the uploaded audio boundary",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());await expect(p.commitBoundary({sessionId:"stream",boundaryMs:50})).rejects.toThrow("boundary_mismatch");
    expect(s.sockets[0].sent).toHaveLength(2);
  });
  it("bounds a lost commit response without auto-reconnect or retry",async()=>{
    vi.useFakeTimers();const s=setup(ws=>ws.autoComplete=false),p=s.create();await p.createSession(session);await p.transcribe(frame());
    const check=expect(p.flush("stream")).rejects.toMatchObject({outcome:"uncertain"});await vi.advanceTimersByTimeAsync(501);await check;
    expect(s.socketFactory).toHaveBeenCalledTimes(1);expect(s.sockets[0].sent.filter(e=>e.type==="input_audio_buffer.commit")).toHaveLength(1);
  });
  it("refuses unbounded socket backpressure before audio write",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);s.sockets[0].bufferedAmount=1048577;await expect(p.transcribe(frame())).rejects.toThrow();expect(s.sockets[0].sent).toHaveLength(1);
  });
  it("does not silently drop requested ASR hints",async()=>{const s=setup();await expect(s.create().createSession({...session,asrHotwords:["term"]})).rejects.toThrow("hints_not_implemented");expect(s.socketFactory).not.toHaveBeenCalled();});
  it.each(["item","previous","error"])("rejects mismatched %s commit responses and discards supplier error text",async kind=>{
    const s=setup(ws=>{ws.autoComplete=false;ws.onSend=e=>{if(e.type!=="input_audio_buffer.commit")return;queueMicrotask(()=>{
      if(kind==="error"){ws.receive({type:"error",error:{message:"SECRET_PROVIDER_ERROR"}});return;}
      ws.receive({type:"input_audio_buffer.committed",item_id:"expected",previous_item_id:kind==="previous"?"wrong":null});
      if(kind==="item")ws.receive({type:"conversation.item.input_audio_transcription.completed",item_id:"wrong",content_index:0,transcript:"wrong"});
    });};}),p=s.create();await p.createSession(session);await p.transcribe(frame());await expect(p.flush("stream")).rejects.toMatchObject({code:"public_asr_stream_protocol",outcome:"uncertain"});
    expect(JSON.stringify(s.record.mock.calls)).not.toContain("SECRET_PROVIDER_ERROR");
  });
  it("accepts a completed event before its commit ACK, but never without the ACK",async()=>{
    const s=setup(ws=>{ws.autoComplete=false;ws.onSend=e=>{if(e.type!=="input_audio_buffer.commit")return;queueMicrotask(()=>{
      const result={type:"conversation.item.input_audio_transcription.completed",item_id:"item",content_index:0,transcript:"Bonjour"};ws.receive(result);ws.receive(result);
      ws.receive({type:"input_audio_buffer.committed",item_id:"item",previous_item_id:null});
    });};}),p=s.create();await p.createSession(session);await p.transcribe(frame());expect((await p.flush("stream"))?.text).toBe("Bonjour");
    expect(s.record.mock.calls.filter(c=>(c as any)[0].state==="confirmed")).toHaveLength(1);
  });
  it("same-ID replacement closes the old socket and ignores its late events",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());await p.createSession(session);
    s.sockets[0].receive({type:"error"});await p.transcribe(frame());expect((await p.flush("stream"))?.text).toBe("Bonjour");expect(s.sockets[0].readyState).toBe(3);
  });
  it("uses server sample ranges, not phone wall-clock timestamps",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);const first=frame(),second=frame(2);second.timestampMs=first.timestampMs;
    await p.transcribe(first);await p.transcribe(second);expect((await p.flush("stream"))?.timing).toMatchObject({startMs:0,endMs:200});
  });
  it("rejects a trusted-range gap rather than compressing dropped audio into the wrong interval",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);await p.transcribe(frame());await expect(p.transcribe(frame(3))).rejects.toThrow("audio_invalid");
    expect(s.sockets[0].sent.filter(e=>e.type==="input_audio_buffer.append")).toHaveLength(1);
  });
  it("rejects concurrent audio before configuration ACK even when the socket is already open",async()=>{
    let entered!:()=>void;const ready=new Promise<void>(r=>entered=r),s=setup(ws=>{ws.autoSetup=false;ws.onSend=e=>{if(e.type==="session.update")entered();};}),p=s.create();
    const opening=p.createSession(session);await ready;await expect(p.transcribe(frame())).rejects.toThrow("not_ready");expect(s.record).not.toHaveBeenCalled();
    s.sockets[0].receive({type:"session.updated",session:s.sockets[0].sent[0].session});await opening;
    const first=frame();first.sequence=0;markAcceptedAudioRange(first,{startSample:0,endSample:2400});await p.transcribe(first);expect((await p.flush("stream"))?.text).toBe("Bonjour");
  });
  it("splits a multi-second force-drained transport batch without treating each write as a turn",async()=>{
    const s=setup(),p=s.create();await p.createSession(session);const f=frame();f.data=Buffer.alloc(96000).toString("base64");markAcceptedAudioRange(f,{startSample:0,endSample:48000});
    await p.transcribe(f);expect(s.sockets[0].sent.filter(e=>e.type==="input_audio_buffer.append")).toHaveLength(2);
    expect(s.sockets[0].sent.map(e=>e.type)).not.toContain("input_audio_buffer.commit");expect((await p.flush("stream"))?.timing?.endMs).toBe(2000);
    expect(new Set(s.record.mock.calls.map(c=>(c as any)[0].attemptId)).size).toBe(1);
  });
  it("pushes cumulative draft events through original Provider without MT and suppresses them after close",async()=>{
    const s=setup(ws=>ws.autoComplete=false),asr=s.create(),translate=vi.fn(async()=>"こんにちは");
    const provider=new LmStudioRealtimeProvider({baseUrl:"https://unused.invalid",model:"mt",timeoutMs:500,asrProvider:asr,translationClient:{translate,healthCheck:async()=>false}});
    await provider.createSession({...session,voiceOutput:false});const partials:any[]=[];const unsubscribe=provider.setEventListener("stream",event=>partials.push(event));
    for await(const _e of provider.sendAudio(frame())){}
    const delta={type:"conversation.item.input_audio_transcription.delta",item_id:"draft",content_index:0};
    s.sockets[0].receive({...delta,delta:"Bon"});s.sockets[0].receive({...delta,delta:"jour"});
    expect(partials.map(e=>[e.type,e.text,e.revision])).toEqual([["transcript.partial","Bon",0],["transcript.partial","Bonjour",0]]);expect(translate).not.toHaveBeenCalled();
    s.sockets[0].onSend=e=>{if(e.type==="input_audio_buffer.commit")queueMicrotask(()=>{
      s.sockets[0].receive({type:"input_audio_buffer.committed",item_id:"draft",previous_item_id:null});
      s.sockets[0].receive({type:"conversation.item.input_audio_transcription.completed",item_id:"draft",content_index:0,transcript:"Bonjour"});
    });};
    const finals=[];for await(const event of provider.flushSession("stream"))finals.push(event);
    expect(finals.some(e=>e.type==="transcript.final"&&e.segmentId===partials[0].segmentId&&e.revision===1)).toBe(true);expect(translate).toHaveBeenCalledTimes(1);
    unsubscribe();await provider.closeSession("stream");s.sockets[0].receive({...delta,delta:"late"});expect(partials).toHaveLength(2);
  });
});
