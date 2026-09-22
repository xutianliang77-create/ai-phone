import {afterEach, describe, expect, it, vi} from "vitest";
import {OpenAiStreamingAsrClient} from "./openai-streaming-asr-client.js";
import {SyntheticQwenAsrSocket} from "./qwen-streaming-asr.test-support.js";
import {HttpAsrProvider} from "./http-asr-provider.js";
import {realtimeLogger} from "../metrics/realtime-metrics.js";
import type {PublicModelAttemptEvent} from "@translation/contracts";

const session={sessionId:"failure-test",sourceLanguage:"auto" as const,targetLanguage:"en" as const};
const request={...session,sequence:1,timestampMs:0,format:"pcm16" as const,sampleRate:16000,
  data:Buffer.alloc(2708).toString("base64"),acceptedAudioRange:{startSample:0,endSample:1354}};
const active:OpenAiStreamingAsrClient[]=[];
function setup() {
  let socket!:SyntheticQwenAsrSocket;
  const record=vi.fn(async(_event:PublicModelAttemptEvent)=>{}),controller=new AbortController();
  const warn=vi.spyOn(realtimeLogger,"warn").mockImplementation(()=>{});
  const client=new OpenAiStreamingAsrClient({sessionId:session.sessionId,leaseId:"lease",endpoint:"wss://synthetic.invalid",
    model:"qwen3-asr-flash-realtime",language:"auto",timeoutMs:500,wireProfile:"qwen_asr_realtime",
    automaticLanguagePair:["zh","en"],automaticSourceLanguages:["zh","en","ja","fr"],record,
    authorizeConnection:async()=>{},resolveCredentials:()=>({apiKey:"SYNTHETIC_NOT_A_KEY"}),socketFactory:()=>{
      socket=new SyntheticQwenAsrSocket();socket.model="qwen3-asr-flash-realtime";socket.autoComplete=false;socket.autoFinish=false;
      return socket.asWebSocket();
    }});
  active.push(client);
  return {client,record,controller,warn,get socket(){return socket;},create:()=>client.createSession(session,controller.signal)};
}
afterEach(async()=>{for(const c of active.splice(0))await c.closeSession(session.sessionId);vi.restoreAllMocks();});

describe("streaming ASR preserves the first failure without leaking provider bodies",()=>{
  it("includes local audio-send observations with a remote 1011 without changing its outcome",async()=>{
    const t=setup();await t.create();await t.client.transcribe(request);
    t.socket.emit("close",1011,Buffer.from("internal audio error SECRET_BODY"));
    await t.client.closeSession(session.sessionId);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"transport_close",closeCode:1011,closeReasonSignals:["internal","audio"],
      audioSend:{appendStarted:1,appendCompleted:1,appendFailed:0,maxPacketAudioMs:85,pendingAudioMs:0}});
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({state:"uncertain",failureCode:"public_asr_stream_closed"});
    expect(JSON.stringify(t.warn.mock.calls)).not.toContain("SECRET");
  });
  it.each(["error","conversation.item.input_audio_transcription.failed"])("handles %s immediately even before any PCM/turn",async type=>{
    const t=setup();await t.create();
    t.socket.receive({type,error:{code:"invalid_value",type:"invalid_request_error",message:"SECRET_BODY",param:"SECRET_PARAM"}});
    await expect(t.client.transcribe(request)).rejects.toMatchObject({code:"public_asr_stream_provider_error",outcome:"not_sent"});
    expect(t.record).not.toHaveBeenCalled();
    expect(t.warn.mock.calls).toHaveLength(1);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"provider_error",eventType:type,providerErrorCode:"invalid_value",providerErrorType:"invalid_request_error"});
    expect(JSON.stringify(t.warn.mock.calls)).not.toContain("SECRET");
  });

  it("keeps an error received during append instead of replacing it by immediate close/cleanup",async()=>{
    const t=setup();await t.create();
    t.socket.onSend=event=>{if(event.type!=="input_audio_buffer.append")return;
      t.socket.receive({type:"error",error:{code:"invalid_value",type:"invalid_request_error",message:"SECRET_BODY"}});
      t.socket.emit("close",1011,Buffer.from("SECRET_CLOSE_REASON"));
    };
    await expect(t.client.transcribe(request)).rejects.toMatchObject({code:"public_asr_stream_provider_error",outcome:"uncertain"});
    await t.client.closeSession(session.sessionId);
    const terminal=t.record.mock.calls.map(([e])=>e).filter(e=>e.state!=="dispatching");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({state:"uncertain",failureCode:"public_asr_stream_provider_error",audioStartSample:0,audioEndSample:1354});
    expect(t.warn.mock.calls).toHaveLength(1);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"provider_error",eventType:"error",providerErrorCode:"invalid_value"});
    expect(JSON.stringify([t.warn.mock.calls,t.record.mock.calls])).not.toContain("SECRET");
  });

  it("does not wait for another frame when an error arrives after the last append",async()=>{
    const t=setup();await t.create();await t.client.transcribe(request);
    t.socket.receive({type:"error",error:{code:"invalid_value"}});
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(t.socket.readyState).toBe(3);
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({state:"uncertain",failureCode:"public_asr_stream_provider_error"});
    expect(t.warn.mock.calls[0][0]).toMatchObject({uploadedSamples:1354,origin:"provider_error",eventType:"error"});
  });

  it("captures remote close code while redacting arbitrary reason bytes",async()=>{
    const t=setup();await t.create();await t.client.transcribe(request);
    t.socket.readyState=3;t.socket.emit("close",1011,Buffer.from("SECRET_REASON"));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({state:"uncertain",failureCode:"public_asr_stream_closed"});
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"transport_close",closeCode:1011,closeReason:"unrecognized",closeReasonBytes:13});
    expect(JSON.stringify(t.warn.mock.calls)).not.toContain("SECRET");
  });

  it("distinguishes caller abort from a subsequent synthetic transport close",async()=>{
    const t=setup();await t.create();await t.client.transcribe(request);t.controller.abort("SECRET_ABORT_REASON");
    await t.client.closeSession(session.sessionId);
    expect(t.warn.mock.calls).toHaveLength(1);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"caller_abort"});
    expect(JSON.stringify(t.warn.mock.calls)).not.toContain("SECRET");
  });

  it("preserves explicit close intent through the original HttpAsrProvider cancellation signal",async()=>{
    const t=setup(),p=new HttpAsrProvider({endpoint:"https://synthetic.invalid",timeoutMs:500,client:t.client});
    await p.createSession(session);await t.client.transcribe(request);await p.closeSession(session.sessionId);
    expect(t.warn.mock.calls).toHaveLength(1);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"explicit_close"});
    expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });

  it("reports only an allowlisted transport error code, not its message or stack",async()=>{
    const t=setup();await t.create();await t.client.transcribe(request);
    t.socket.emit("error",Object.assign(new Error("SECRET_MESSAGE"),{code:"ECONNRESET"}));
    await t.client.closeSession(session.sessionId);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"transport_error",transportErrorCode:"ECONNRESET"});
    expect(JSON.stringify(t.warn.mock.calls)).not.toContain("SECRET");
  });

  it("classifies an unsolicited Qwen session.finished before a following close",async()=>{
    const t=setup();await t.create();await t.client.transcribe(request);
    t.socket.receive({type:"session.finished"});t.socket.emit("close",1000,Buffer.alloc(0));
    await t.client.closeSession(session.sessionId);
    expect(t.warn.mock.calls[0][0]).toMatchObject({origin:"protocol",eventType:"session.finished",code:"public_asr_stream_protocol"});
  });

  it("keeps normal finish confirmed and does not report wrapper cleanup as a failure",async()=>{
    const t=setup(),p=new HttpAsrProvider({endpoint:"https://synthetic.invalid",timeoutMs:500,client:t.client});
    await p.createSession(session);await t.client.transcribe(request);
    t.socket.onSend=e=>{if(e.type==="session.finish")t.socket.receive({type:"session.finished"});};
    await p.flush(session.sessionId,{finishSession:true});await p.closeSession(session.sessionId);
    expect(t.record.mock.calls.at(-1)![0].state).toBe("confirmed");
    expect(t.warn).not.toHaveBeenCalled();
  });
});
