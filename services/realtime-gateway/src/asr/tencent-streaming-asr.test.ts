import {afterEach,describe,expect,it,vi} from "vitest";
import type {AudioFrame,PublicModelAttemptEvent} from "@translation/contracts";
import {ProviderRouter} from "../providers/provider-router.js";
import type {ConfiguredStreamingAsrOptions} from "./configured-public-asr.js";
import type {HttpAsrProvider} from "./http-asr-provider.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";
import {SyntheticTencentAsrSocket} from "./tencent-streaming-asr.test-support.js";
import {tencentAsrUrl} from "./tencent-streaming-asr.js";
const active:HttpAsrProvider[]=[];
const session={sessionId:"tencent-asr",sourceLanguage:"en" as const,targetLanguage:"zh" as const};
function frame(n=1):AudioFrame{const f:AudioFrame={type:"audio.frame",sessionId:session.sessionId,sequence:n,timestampMs:1788883200000,format:"pcm16",sampleRate:16000,data:Buffer.alloc(3200).toString("base64")};markAcceptedAudioRange(f,{startSample:(n-1)*1600,endSample:n*1600});return f;}
function setup(configure?:(s:SyntheticTencentAsrSocket)=>void){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const sockets:SyntheticTencentAsrSocket[]=[],record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),authorizeConnection=vi.fn(async()=>{}),resolveCredentials=vi.fn(async()=>({secretId:"SYNTHETIC_ID",secretKey:"SYNTHETIC_KEY"}));
  const socketFactory=vi.fn((url:string,_options:unknown)=>{const s=new SyntheticTencentAsrSocket(new URL(url).searchParams.get("voice_id")!);configure?.(s);sockets.push(s);return s.asWebSocket();});
  const options:ConfiguredStreamingAsrOptions={deploymentId:"public",sessionId:session.sessionId,leaseId:"lease",record,authorizeConnection,resolveCredentials,socketFactory,
    snapshot:{deploymentId:"public",configurationRevision:1,modelPolicyRevision:"policy",executionPlan:plan,components:{asr:{enabled:true,vendor:"tencent",protocol:"tencent_asr_ws",authKind:"tencent_secret",endpoint:"wss://asr.cloud.tencent.com/asr/v2/10001",appId:"10001",modelId:"16k_en",sampleRate:16000,timeoutMs:500}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"en",target:"zh",autoReverse:false,revision:1},syncPermission:{allowed:false}}};
  const create=()=>{const p=new ProviderRouter().createConfiguredStreamingAsrProvider(options);active.push(p);return p;};return {options,sockets,record,authorizeConnection,resolveCredentials,socketFactory,create};
}
afterEach(async()=>{for(const p of active.splice(0))await p.closeSession(session.sessionId);vi.useRealTimers();vi.restoreAllMocks();});
describe("Tencent ASR wire on shared lifecycle",()=>{
  it("uses the Tencent ASR signing string without TTS GET prefix",()=>{
    const url=tencentAsrUrl({sessionId:"s",leaseId:"l",endpoint:"wss://asr.cloud.tencent.com/asr/v2/10001",appId:"10001",model:"16k_en",language:"en",timeoutMs:500,authorizeConnection:async()=>{},resolveCredentials:()=>({}),record:async()=>{}},
      {secretId:"SYNTHETIC_ID",secretKey:"SYNTHETIC_KEY"},"0123456789abcdef",1700000000000,123);
    expect(new URL(url).searchParams.get("signature")).toBe("fiPep5D8OVuuU4S/JFvoWJsGzDo=");expect(url).not.toContain("SYNTHETIC_KEY");
  });
  it("opens lazily, paces 40ms PCM and waits for stream-final before confirming",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);expect(t.socketFactory).not.toHaveBeenCalled();const partial:string[]=[];p.setPartialListener(session.sessionId,e=>partial.push(e.text));
    await p.transcribe(frame());const s=t.sockets[0];expect(s.sent.filter(Buffer.isBuffer).map(b=>(b as Buffer).length)).toEqual([1280,1280,640]);
    expect(s.sentAt[1]-s.sentAt[0]).toBeGreaterThanOrEqual(38);expect(s.sentAt[2]-s.sentAt[1]).toBeGreaterThanOrEqual(38);
    expect(partial.at(-1)).toBe("draft 1600");expect(t.record.mock.calls.at(-1)![0].state).toBe("dispatching");
    expect(await p.flush(session.sessionId)).toMatchObject({text:"Hello world.",language:"en",timing:{startMs:0,endMs:100}});
    expect(s.sent.at(-1)).toEqual({type:"end"});expect(t.record.mock.calls.at(-1)![0]).toMatchObject({providerId:"tencent",audioSampleRate:16000,state:"confirmed"});
    expect(t.record.mock.calls.at(-1)![0].metadata?.usage).toBeUndefined();expect(await p.healthCheck()).toBe(false);
  });
  it("creates a fresh signed voice ID for the next endpoint, preserving global sample coordinates",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);await p.transcribe(frame());await p.flush(session.sessionId);
    await p.transcribe(frame(2));const r=await p.commitBoundary({sessionId:session.sessionId,boundaryMs:200});
    expect(r?.timing).toMatchObject({startMs:100,endMs:200});expect(t.sockets).toHaveLength(2);expect(t.sockets[0].voiceId).not.toBe(t.sockets[1].voiceId);
    expect(t.sockets.every(s=>s.readyState===3)).toBe(true);expect(t.resolveCredentials).toHaveBeenCalledTimes(2);
  });
  it.each([["16k_zh","zh"],["16k_zh_large","zh"],["16k_yue","yue"],["16k_zh-TW","zh-Hant"],["16k_ar","ar"],["16k_ko","ko"],["16k_ja","ja"],["16k_th","th"],["16k_id","id"],["16k_ms","ms"]])("validates engine %s for source %s",async(model,language)=>{
    const t=setup();t.options.snapshot.components.asr!.modelId=model;t.options.authorization.languagePolicy={source:language as any,target:"en",autoReverse:false,revision:2};
    const p=t.create();await p.createSession({...session,sourceLanguage:language as any});await p.transcribe(frame());
    expect(new URL(t.socketFactory.mock.calls[0][0]).searchParams.get("engine_model_type")).toBe(model);
  });
  it.each(["engine","language","appid","rate","auth"])("refuses unsupported %s before any credentials/socket",kind=>{
    const t=setup(),p=t.options.snapshot.components.asr!;if(kind==="engine")p.modelId="8k_en";if(kind==="language")t.options.authorization.languagePolicy.source="fr";
    if(kind==="appid")p.appId="999";if(kind==="rate")p.sampleRate=24000;if(kind==="auth")p.authKind="api_key";
    expect(t.create).toThrow();expect(t.resolveCredentials).not.toHaveBeenCalled();expect(t.socketFactory).not.toHaveBeenCalled();
  });
  it("rejects missing sampling provenance before lazy opening",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);await expect(p.transcribe({...frame()})).rejects.toThrow("audio_invalid");expect(t.socketFactory).not.toHaveBeenCalled();
  });
  it("does not retry a missing stream-final",async()=>{
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]});const t=setup(s=>s.autoFinal=false),p=t.create();await p.createSession(session);
    const send=p.transcribe(frame());await vi.advanceTimersByTimeAsync(100);await send;
    const check=expect(p.flush(session.sessionId)).rejects.toThrow();await vi.advanceTimersByTimeAsync(501);await check;
    expect(t.socketFactory).toHaveBeenCalledTimes(1);expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it("does not send PCM without handshake ACK",async()=>{
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]});const t=setup(s=>s.autoAck=false),p=t.create();await p.createSession(session);
    const check=expect(p.transcribe(frame())).rejects.toThrow();await vi.advanceTimersByTimeAsync(501);await check;expect(t.sockets[0].sent).toEqual([]);
    expect(t.record.mock.calls.at(-1)![0].state).toBe("not_sent");
  });
  it("does not treat a final marker without a stable result as successful recognition",async()=>{
    const t=setup(s=>{s.autoFinal=false;s.onSend=e=>{if(!Buffer.isBuffer(e)&&e.type==="end")s.receive({message_id:"missing-stable",final:1});};});
    const p=t.create();await p.createSession(session);await p.transcribe(frame());await expect(p.flush(session.sessionId)).rejects.toThrow();
    expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it("cancels paced upload without sending end or a second socket",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);const pending=p.transcribe(frame());const check=expect(pending).rejects.toThrow();
    await vi.waitFor(()=>expect(t.sockets[0]?.sent.length).toBeGreaterThan(0));await p.closeSession(session.sessionId);await check;
    expect(t.sockets[0].sent.every(Buffer.isBuffer)).toBe(true);expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");expect(t.socketFactory).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong_voice","error","index","final_early"])("fails closed on %s without provider detail leakage",async kind=>{
    const t=setup(s=>s.onSend=e=>{if(!Buffer.isBuffer(e))return;
      if(kind==="wrong_voice")s.receive({voice_id:"wrong"});else if(kind==="error")s.receive({code:4003,message:"SECRET_PROVIDER"});
      else if(kind==="index")s.result(1,"draft",{index:1});else s.receive({message_id:"early",final:1});});
    const p=t.create();await p.createSession(session);await expect(p.transcribe(frame())).rejects.toThrow();expect(JSON.stringify(t.record.mock.calls)).not.toContain("SECRET_PROVIDER");
  });
});
