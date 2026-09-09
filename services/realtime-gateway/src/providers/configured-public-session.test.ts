import {afterEach, describe, expect, it, vi} from "vitest";
import type {AudioFrame, PublicModelAttemptEvent} from "@translation/contracts";
import {ProviderRouter} from "./provider-router.js";
import type {ConfiguredPublicSessionOptions} from "./configured-public-session.js";
import {LmStudioRealtimeProvider} from "./lmstudio/lmstudio-realtime-provider.js";
import {SyntheticAsrSocket} from "../asr/streaming-asr.test-support.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";

const active:LmStudioRealtimeProvider[]=[];
function setup(vendor="qwen",protocol="qwen_chat") {
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const sockets:SyntheticAsrSocket[]=[];
  const recordAttempt=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),authorizeConnection=vi.fn(async()=>{});
  const resolveAsrCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_ASR"}));
  const resolveTranslationCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_MT",accessToken:"SYNTHETIC_TOKEN",accessTokenExpiresAt:Date.now()+3600000}));
  const fetchFn=vi.fn(async()=>new Response(JSON.stringify(vendor==="google"?
    {candidates:[{finishReason:"STOP",content:{role:"model",parts:[{text:"こんにちは。"}]}}]}:
    {choices:[{finish_reason:"stop",message:{content:"こんにちは。"}}]})));
  const socketFactory=vi.fn(()=>{const socket=new SyntheticAsrSocket();socket.transcript="Bonjour tout le monde.";sockets.push(socket);return socket.asWebSocket();});
  const options:ConfiguredPublicSessionOptions={
    session:{sessionId:"session",userId:"owner",sourceLanguage:"fr",targetLanguage:"ja",voiceOutput:false,asrEndpointMode:"listening"},
    binding:{sessionId:"session",ownerId:"owner",deploymentId:"public-test",modelPolicyRevision:"policy",leaseId:"lease",captureId:"capture",languagePolicyKey:"language:1",sampleRate:24000},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",publicGrantRef:"grant",executionPlan:plan,
      languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},syncPermission:{allowed:false}},
    snapshot:{deploymentId:"public-test",configurationRevision:1,configurationHash:"a".repeat(64),modelPolicyRevision:"policy",executionPlan:plan,
      components:{asr:{enabled:true,vendor:"openai",protocol:"openai_realtime_asr",authKind:"api_key",endpoint:"wss://synthetic.invalid/v1/realtime",modelId:"manual-asr",timeoutMs:500,sampleRate:24000},
        translation:{enabled:true,vendor,protocol,authKind:protocol==="google_vertex_gemini"?"google_service_account":"api_key",
          endpoint:"https://synthetic.invalid/v1",modelId:"manual-mt",timeoutMs:1000,maxTokens:700,projectId:"project",location:"global"}}},
    recordAttempt,authorizeConnection,resolveAsrCredentials,resolveTranslationCredentials,fetchFn,socketFactory,listeningMaxContinuationBufferMs:500};
  const create=()=>{const p=new ProviderRouter().createConfiguredPublicSessionProvider(options);active.push(p);return p;};
  return {options,create,sockets,recordAttempt,authorizeConnection,resolveAsrCredentials,resolveTranslationCredentials,fetchFn,socketFactory};
}
const frame=():AudioFrame=>{const f:AudioFrame={type:"audio.frame",sessionId:"session",sequence:1,timestampMs:1788883200000,format:"pcm16",sampleRate:24000,data:Buffer.alloc(9600).toString("base64")};
  markAcceptedAudioRange(f,{startSample:0,endSample:4800});return f;};
afterEach(async()=>{for(const p of active.splice(0))await p.closeSession("session");vi.restoreAllMocks();vi.useRealTimers();});
describe("original Router assembles one bound public audio session",()=>{
  it("atomically assembles the original ASR/MT Provider and bound TTS queue",async()=>{
    const s=setup();s.options.session.voiceOutput=true;
    const plan={...s.options.authorization.executionPlan,tts:{execution:"public" as const,scopeKey:"tts",reason:"online_selected" as const}};
    s.options.authorization.executionPlan=plan;s.options.snapshot.executionPlan=plan;
    s.options.snapshot.components.tts={enabled:true,vendor:"openai",protocol:"openai_speech",authKind:"api_key",endpoint:"https://synthetic.invalid/v1",modelId:"manual-tts",voice:"coral",timeoutMs:500,sampleRate:24000};
    const ttsFetch=vi.fn(async()=>new Response(Buffer.alloc(1920),{headers:{"content-type":"audio/pcm"}}));
    s.options.output={prefillMs:20,isSessionActive:()=>true,resolveCredentials:()=>({apiKey:"SYNTHETIC_TTS"}),fetchFn:ttsFetch};
    expect(s.create).toThrow("output_required");
    const {provider,ttsOutput}=new ProviderRouter().createConfiguredPublicSessionComponents(s.options);active.push(provider);
    expect(s.socketFactory).not.toHaveBeenCalled();expect(ttsFetch).not.toHaveBeenCalled();
    expect(ttsOutput!.setVoiceOutput(true,"unbound-voice")).toBe(false);
    await provider.createSession(s.options.session);for await(const _ of provider.sendAudio(frame())){}
    const events:any[]=[];for await(const e of provider.flushSession("session")){events.push(e);ttsOutput!.enqueue(e,a=>events.push(a));}await ttsOutput!.drain();
    expect(events.some(e=>e.type==="audio.output")).toBe(true);expect(ttsFetch).toHaveBeenCalledTimes(1);
    expect(s.recordAttempt.mock.calls.filter(c=>c[0].state==="confirmed").map(c=>c[0].component)).toEqual(["asr","translation","tts"]);
    ttsOutput!.close();await ttsOutput!.drainInFlight();
  });
  it("rejects invalid TTS in combined assembly before opening ASR",()=>{
    const s=setup();s.options.session.voiceOutput=true;
    const plan={...s.options.authorization.executionPlan,tts:{execution:"public" as const,scopeKey:"tts",reason:"online_selected" as const}};
    s.options.authorization.executionPlan=plan;s.options.snapshot.executionPlan=plan;
    s.options.snapshot.components.tts={enabled:true,vendor:"openai",protocol:"openai_speech",authKind:"api_key",endpoint:"http://private.invalid",modelId:"m",voice:"v",timeoutMs:500,sampleRate:24000};
    s.options.output={prefillMs:20,isSessionActive:()=>true,resolveCredentials:()=>({apiKey:"SYNTHETIC"})};
    expect(()=>new ProviderRouter().createConfiguredPublicSessionComponents(s.options)).toThrow();expect(s.socketFactory).not.toHaveBeenCalled();expect(s.authorizeConnection).not.toHaveBeenCalled();
  });
  it.each([["qwen","qwen_chat"],["tencent","tencent_hunyuan_chat"],["openai","openai_chat"],["google","google_gemini"],["google","google_vertex_gemini"]])(
    "assembles ASR and %s/%s MT through the existing Provider and journal",async(vendor,protocol)=>{
      const s=setup(vendor,protocol),p=s.create();expect(p).toBeInstanceOf(LmStudioRealtimeProvider);
      expect(await p.healthCheck()).toBe(false);expect(s.authorizeConnection).not.toHaveBeenCalled();expect(s.socketFactory).not.toHaveBeenCalled();
      await p.createSession(s.options.session);expect(s.authorizeConnection).toHaveBeenCalledTimes(1);
      const partials:unknown[]=[];p.setEventListener("session",e=>partials.push(e));
      for await(const _ of p.sendAudio(frame())){}const events=[];for await(const e of p.flushSession("session"))events.push(e);
      expect(events).toContainEqual(expect.objectContaining({type:"transcript.final",language:"fr"}));
      expect(events).toContainEqual(expect.objectContaining({type:"translation.final",language:"ja",text:"こんにちは。"}));
      expect(partials).toContainEqual(expect.objectContaining({type:"transcript.partial",revision:0}));
      const attempts=s.recordAttempt.mock.calls.map(c=>c[0]);expect(attempts.filter(e=>e.state==="confirmed").map(e=>e.component)).toEqual(["asr","translation"]);
      expect(attempts.every(e=>e.sessionId==="session"&&e.leaseId==="lease")).toBe(true);
      expect(s.fetchFn).toHaveBeenCalledTimes(1);expect(JSON.stringify(attempts)).not.toContain("SYNTHETIC_");
      await p.closeSession("session");expect(s.sockets[0].readyState).toBe(3);
    });
  const invalid:Array<[string,(o:ConfiguredPublicSessionOptions)=>void]>=[
    ["owner",o=>o.session.userId="other"], ["session",o=>o.session.sessionId="other"],
    ["deployment",o=>o.binding.deploymentId="other"], ["policy",o=>o.binding.modelPolicyRevision="other"],
    ["lease",o=>o.binding.leaseId=""], ["grant",o=>delete o.authorization.publicGrantRef],
    ["rate",o=>o.binding.sampleRate=16000], ["model rate",o=>o.snapshot.components.asr!.sampleRate=16000],
    ["TTS",o=>o.session.voiceOutput=true],
    ["TTS plan",o=>o.authorization.executionPlan={...o.authorization.executionPlan,tts:{execution:"public",reason:"online_selected",scopeKey:"tts"}}],
    ["auto",o=>o.authorization.languagePolicy.source="auto"], ["reverse",o=>o.session.autoReverseTargetLanguage=true],
    ["language",o=>o.session.targetLanguage="en"], ["hints",o=>o.session.asrHotwords=["word"]],
    ["corrections",o=>o.session.asrCorrections=[{fromText:"a",toText:"b"}]],
    ["speaker",o=>o.session.speakerAttribution={mode:"diarization"}], ["call",o=>o.session.asrEndpointMode="call_link"],
    ["ASR protocol",o=>o.snapshot.components.asr!.protocol="qwen_asr"],
    ["MT protocol",o=>o.snapshot.components.translation!.protocol="unknown"],
    ["MT URL",o=>o.snapshot.components.translation!.endpoint="http://private.invalid"],
    ["MT query",o=>o.snapshot.components.translation!.endpoint="https://synthetic.invalid/?key=secret"],
    ["MT limit",o=>o.snapshot.components.translation!.maxTokens=0],
    ["buffer",o=>o.listeningMaxContinuationBufferMs=Infinity],
  ];
  it.each(invalid)("rejects unsupported or mismatched %s before callbacks or model calls",(_name,change)=>{
    const s=setup();change(s.options);expect(s.create).toThrow();
    for(const call of [s.recordAttempt,s.authorizeConnection,s.resolveAsrCredentials,s.resolveTranslationCredentials,s.fetchFn,s.socketFactory])expect(call).not.toHaveBeenCalled();
  });
  it("rejects malformed Google resource path before ASR setup",()=>{
    const s=setup("google","google_vertex_gemini");s.options.snapshot.components.translation!.endpoint="https://synthetic.invalid/chat/completions";
    expect(s.create).toThrow("translation_configuration");expect(s.socketFactory).not.toHaveBeenCalled();
  });
  it("freezes session/configuration identity and refuses another owner before consuming the one-shot session",async()=>{
    const s=setup(),original=structuredClone(s.options.session),p=s.create();s.options.session.userId="mutated";s.options.snapshot.components.asr!.modelId="mutated";
    await expect(p.createSession(s.options.session)).rejects.toThrow("rebind_forbidden");expect(s.authorizeConnection).not.toHaveBeenCalled();
    await p.createSession(original);expect(s.sockets[0].sent[0].session.audio.input.transcription.model).toBe("manual-asr");
    await expect(p.createSession(original)).rejects.toThrow("rebind_forbidden");await p.closeSession(original.sessionId);
    await expect(p.createSession(original)).rejects.toThrow("rebind_forbidden");expect(s.socketFactory).toHaveBeenCalledTimes(1);
  });
  it("does not bypass admission or retry a refused startup",async()=>{
    const s=setup();s.authorizeConnection.mockRejectedValue(Error("revoked"));const p=s.create();
    await expect(p.createSession(s.options.session)).rejects.toThrow();await expect(p.createSession(s.options.session)).rejects.toThrow("rebind_forbidden");
    expect(s.resolveAsrCredentials).not.toHaveBeenCalled();expect(s.socketFactory).not.toHaveBeenCalled();
  });
  it("close during preparation prevents a late callback from opening ASR",async()=>{
    const s=setup();let release!:()=>void;s.authorizeConnection.mockImplementation(()=>new Promise<void>(r=>release=r));
    const p=s.create(),pending=p.createSession(s.options.session);const rejected=expect(pending).rejects.toThrow();
    await vi.waitFor(()=>expect(release).toBeTypeOf("function"));await p.closeSession("session");release();await rejected;
    expect(s.socketFactory).not.toHaveBeenCalled();await expect(p.createSession(s.options.session)).rejects.toThrow("rebind_forbidden");
  });
  it("closing before start seals this candidate and does not open a connection",async()=>{
    const s=setup(),p=s.create();await p.closeSession("session");await expect(p.createSession(s.options.session)).rejects.toThrow("rebind_forbidden");
    expect(s.authorizeConnection).not.toHaveBeenCalled();
  });
  it("rejects unadmitted direct text input and keeps the public entry gate closed",async()=>{
    const s=setup(),p=s.create();await p.createSession(s.options.session);
    await expect(p.sendText({sessionId:"session",segmentId:"segment",text:"hello",language:"en",isFinal:true}).next()).rejects.toThrow("text_input_not_admitted");
    expect(s.fetchFn).not.toHaveBeenCalled();expect(()=>new ProviderRouter().selectProvider({publicDeploymentId:"public-test"} as never)).toThrow("public_processing_not_ready");
  });
});
