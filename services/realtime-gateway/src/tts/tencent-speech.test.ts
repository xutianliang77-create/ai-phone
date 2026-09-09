import {afterEach,describe,expect,it,vi} from "vitest";
import type {PublicModelAttemptEvent,TranslationEvent} from "@translation/contracts";
import type {HttpTtsSynthesizer} from "./http-tts-synthesizer.js";
import {configuredPublicTts,type ConfiguredPublicTtsOptions} from "./configured-public-tts.js";
import {tencentSpeechUrl} from "./tencent-speech.js";
import {SyntheticTencentSpeechSocket} from "./tencent-speech.test-support.js";
const active:HttpTtsSynthesizer[]=[];
function setup(configure?:(s:SyntheticTencentSpeechSocket)=>void){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"public",reason:"online_selected",scopeKey:"tts"}} as const;
  const record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),resolveCredentials=vi.fn(async()=>({secretId:"SYNTHETIC_ID",secretKey:"SYNTHETIC_KEY"})),sockets:SyntheticTencentSpeechSocket[]=[];
  const socketFactory=vi.fn((url:string,_options:unknown)=>{const s=new SyntheticTencentSpeechSocket(new URL(url).searchParams.get("SessionId")!);configure?.(s);sockets.push(s);return s.asWebSocket();});
  const options:ConfiguredPublicTtsOptions={sessionId:"tts-session",leaseId:"lease",deploymentId:"public",prefillMs:20,
    snapshot:{deploymentId:"public",configurationRevision:1,configurationHash:"a".repeat(64),modelPolicyRevision:"policy",executionPlan:plan,
      components:{tts:{enabled:true,vendor:"tencent",protocol:"tencent_tts_ws",authKind:"tencent_secret",endpoint:"wss://tts.cloud.tencent.com/stream_wsv2",appId:"10001",modelId:"service:tencent_tts_ws",voice:"101001",timeoutMs:500,sampleRate:16000}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false}},
    record,resolveCredentials,socketFactory};
  const create=()=>{const s=configuredPublicTts(options);active.push(s);return s;};return {options,record,resolveCredentials,socketFactory,sockets,create};
}
const event=():TranslationEvent=>({type:"translation.final",sessionId:"tts-session",segmentId:"seg",revision:1,language:"en",text:"Hello world."});
async function collect(s:HttpTtsSynthesizer,e=event()){const audio=[];for await(const a of s.synthesizeStream(e))audio.push(a);return audio;}
afterEach(()=>{for(const s of active.splice(0))s.closeSession("tts-session");vi.restoreAllMocks();vi.useRealTimers();});
describe("Tencent signed TTS wire on original public lifecycle",()=>{
  it("matches a fixed canonical HMAC-SHA1 vector without text or SecretKey in the URL",()=>{
    const url=tencentSpeechUrl({sessionId:"s",leaseId:"l",endpoint:"wss://tts.cloud.tencent.com/stream_wsv2",appId:"10001",voice:"101001",modelId:"service:tencent_tts_ws",targetLanguage:"en",
      sampleRate:16000,timeoutMs:500,prefillMs:20,resolveCredentials:()=>({}),record:async()=>{}},{secretId:"SYNTHETIC_ID",secretKey:"SYNTHETIC_KEY"},"wire",1700000000000);
    expect(new URL(url).searchParams.get("Signature")).toBe("0TYAJKOVIDs2cho0ystlVJn1xI0=");expect(url).toContain("%3D");
    expect(url).not.toContain("SYNTHETIC_KEY");expect(url).not.toContain("Text=");
  });
  it.each([16000,24000] as const)("keeps declared %i PCM rate and journals before text, confirming only final",async rate=>{
    const t=setup(s=>s.onSend=e=>{if(e.action==="ACTION_SYNTHESIS")expect(t.record.mock.calls[0][0].state).toBe("dispatching");});t.options.snapshot.components.tts!.sampleRate=rate;
    const audio=await collect(t.create());expect(audio.every(a=>a.sampleRate===rate&&a.format==="pcm16")).toBe(true);
    expect(Buffer.concat(audio.map(a=>Buffer.from(a.data,"base64")))).toEqual(Buffer.alloc(1920));
    const url=new URL(t.socketFactory.mock.calls[0][0]);expect(url.searchParams.get("SampleRate")).toBe(String(rate));expect(url.searchParams.get("VoiceType")).toBe("101001");
    expect(url.searchParams.has("model")).toBe(false);expect(t.socketFactory.mock.calls[0][1]).toMatchObject({followRedirects:false});
    expect(t.sockets[0].sent.map(e=>e.action)).toEqual(["ACTION_SYNTHESIS","ACTION_COMPLETE"]);
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({providerId:"tencent",modelId:"service:tencent_tts_ws",state:"confirmed",metadata:{requestId:"tencent-request"}});
    expect(t.record.mock.calls.at(-1)![0].metadata?.usage).toBeUndefined();expect(t.record.mock.calls.at(-1)![0].metadata?.reportedModel).toBeUndefined();
    expect(JSON.stringify(t.record.mock.calls)).not.toContain("SYNTHETIC");expect(t.sockets[0].readyState).toBe(3);
  });
  it("does not send after handshake until READY",async()=>{
    const t=setup(s=>s.autoReady=false),p=collect(t.create());await vi.waitFor(()=>expect(t.sockets).toHaveLength(1));expect(t.sockets[0].sent).toEqual([]);
    t.sockets[0].control({ready:1});await p;expect(t.sockets[0].sent[0].data).toBe("Hello world.");
  });
  it.each(["appId","voice","clone","language","path","auth","scheme"])("rejects invalid %s before credentials/socket",kind=>{
    const t=setup(),p=t.options.snapshot.components.tts!;if(kind==="appId")p.appId="0";if(kind==="voice")p.voice="not-a-number";if(kind==="clone")p.voice="200000000";
    if(kind==="language")t.options.authorization.languagePolicy.target="ja";if(kind==="path")p.endpoint="wss://tts.cloud.tencent.com/stream_ws";
    if(kind==="auth")p.authKind="api_key";if(kind==="scheme")p.endpoint="https://tts.cloud.tencent.com/stream_wsv2";
    expect(t.create).toThrow();expect(t.resolveCredentials).not.toHaveBeenCalled();expect(t.socketFactory).not.toHaveBeenCalled();
  });
  it("keeps Chinese input and rejects mismatched language or SSML without transmission",async()=>{
    const t=setup();t.options.authorization.languagePolicy={source:"en",target:"zh",autoReverse:false,revision:2};await collect(t.create(),{...event(),language:"zh",text:"原文保持不变。"});
    expect(t.sockets[0].sent[0].data).toBe("原文保持不变。");const u=setup();await expect(collect(u.create(),{...event(),text:"<speak>Hello</speak>"})).rejects.toThrow("input_scope");expect(u.socketFactory).not.toHaveBeenCalled();
  });
  it.each(["no_ready","no_final","closed"])("bounds %s without retry",async kind=>{
    vi.useFakeTimers();const t=setup(s=>{if(kind==="no_ready")s.autoReady=false;if(kind==="no_final")s.autoFinal=false;
      if(kind==="closed"){s.autoAudio=false;s.autoFinal=false;s.onSend=()=>queueMicrotask(()=>s.terminate());}});
    const check=expect(collect(t.create())).rejects.toThrow();await vi.advanceTimersByTimeAsync(501);await check;expect(t.socketFactory).toHaveBeenCalledTimes(1);
    expect(t.record.mock.calls.at(-1)![0].state).toBe(kind==="no_ready"?"not_sent":"uncertain");
  });
  it.each(["session","request","duplicate","early_audio","odd","error","overflow"])("rejects %s corruption without leaking provider text",async kind=>{
    const t=setup(s=>{s.autoReady=false;s.onSend=e=>{if(e.action!=="ACTION_SYNTHESIS")return;
      if(kind==="request")s.control({request_id:"wrong"});if(kind==="session")s.control({session_id:"wrong"});
      if(kind==="duplicate")s.control({message_id:"message-1"});if(kind==="error")s.control({code:20000,message:"SECRET_PROVIDER"});
    };
      if(kind==="odd")s.audio=()=>s.emit("message",Buffer.alloc(3),true);
      if(kind==="overflow")s.audio=()=>{s.emit("message",Buffer.alloc(200000),true);s.emit("message",Buffer.alloc(200000),true);};
      queueMicrotask(()=>kind==="early_audio"?s.audio():s.control({ready:1}));
    });
    await expect(collect(t.create())).rejects.toThrow(/tencent_tts/);expect(JSON.stringify(t.record.mock.calls)).not.toContain("SECRET_PROVIDER");
  });
  it("supports binary boundaries splitting a PCM sample",async()=>{
    const t=setup(s=>s.audio=()=>{s.emit("message",Buffer.alloc(3),true);s.emit("message",Buffer.alloc(1917),true);});
    const a=await collect(t.create());expect(a.every(e=>Buffer.from(e.data,"base64").length%2===0)).toBe(true);
  });
  it("aborts and prevents repeated synthesis after a prefix",async()=>{
    const t=setup(s=>s.autoFinal=false),s=t.create(),it=s.synthesizeStream(event())[Symbol.asyncIterator]();expect((await it.next()).done).toBe(false);
    s.cancelSession("tts-session");await it.return?.();expect(t.sockets[0].readyState).toBe(3);expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
    expect(await collect(s)).toEqual([]);expect(t.socketFactory).toHaveBeenCalledTimes(1);
  });
});
