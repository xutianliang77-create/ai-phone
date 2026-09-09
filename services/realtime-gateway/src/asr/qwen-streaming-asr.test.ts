import {afterEach,describe,expect,it,vi} from "vitest";
import type {AudioFrame,PublicModelAttemptEvent} from "@translation/contracts";
import {ProviderRouter} from "../providers/provider-router.js";
import type {ConfiguredStreamingAsrOptions} from "./configured-public-asr.js";
import type {HttpAsrProvider} from "./http-asr-provider.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";
import {SyntheticQwenAsrSocket} from "./qwen-streaming-asr.test-support.js";
const active:HttpAsrProvider[]=[];
const session={sessionId:"qwen-asr",sourceLanguage:"fr" as const,targetLanguage:"en" as const};
function frame(n=1):AudioFrame{const f:AudioFrame={type:"audio.frame",sessionId:session.sessionId,sequence:n,timestampMs:1788883200000,format:"pcm16",sampleRate:16000,data:Buffer.alloc(3200).toString("base64")};markAcceptedAudioRange(f,{startSample:(n-1)*1600,endSample:n*1600});return f;}
function setup(configure?:(s:SyntheticQwenAsrSocket)=>void){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const sockets:SyntheticQwenAsrSocket[]=[],record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),authorizeConnection=vi.fn(async()=>{}),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_KEY"}));
  const socketFactory=vi.fn((url:string,_options:unknown)=>{const s=new SyntheticQwenAsrSocket();s.model=new URL(url).searchParams.get("model")!;configure?.(s);sockets.push(s);return s.asWebSocket();});
  const options:ConfiguredStreamingAsrOptions={deploymentId:"public",sessionId:session.sessionId,leaseId:"lease",record,authorizeConnection,resolveCredentials,socketFactory,
    snapshot:{deploymentId:"public",configurationRevision:1,modelPolicyRevision:"policy",executionPlan:plan,components:{asr:{enabled:true,vendor:"qwen",protocol:"qwen_asr_realtime",authKind:"api_key",endpoint:"wss://synthetic.invalid/api-ws/v1/realtime",modelId:"manual-asr",sampleRate:16000,timeoutMs:500}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"fr",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false}}};
  const create=()=>{const p=new ProviderRouter().createConfiguredStreamingAsrProvider(options);active.push(p);return p;};return {options,sockets,record,authorizeConnection,resolveCredentials,socketFactory,create};
}
afterEach(async()=>{for(const p of active.splice(0))await p.closeSession(session.sessionId);vi.useRealTimers();vi.restoreAllMocks();});
describe("Qwen ASR wire on original shared streaming lifecycle",()=>{
  it("configures 16k manual endpoints and replaces cumulative drafts before final",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);const partial:string[]=[];p.setPartialListener(session.sessionId,e=>partial.push(e.text));
    expect(t.sockets[0].sent[0].session).toEqual({input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:{language:"fr"},turn_detection:null});
    await p.transcribe(frame());await p.transcribe(frame(2));const result=await p.flush(session.sessionId);
    expect(partial).toEqual(["Bonjur","Bonjour tout le monde."]);expect(result).toMatchObject({text:"Bonjour tout le monde.",language:"fr",timing:{startMs:0,endMs:200}});
    const events=t.record.mock.calls.map(c=>c[0]);expect(events.map(e=>e.audioEndSample)).toEqual([1600,3200,3200,3200]);expect(events.every(e=>e.providerId==="qwen"&&e.audioSampleRate===16000)).toBe(true);
    expect(events.at(-1)!.metadata?.usage).toBeUndefined();expect(new Set(t.sockets[0].sent.map(e=>e.event_id)).size).toBe(t.sockets[0].sent.length);
    expect(await p.healthCheck()).toBe(false);
  });
  it.each(["zh","yue","en","ja","de","ko","ru","fr","pt","ar","it","es","hi","id","th","tr","uk","vi","cs","ms","pl"])("forwards supported source %s without fixed Chinese",async language=>{
    const t=setup();t.options.authorization.languagePolicy={source:language as any,target:language==="en"?"fr":"en",autoReverse:false,revision:2};
    await t.create().createSession({...session,sourceLanguage:language as any});expect(t.sockets[0].sent[0].session.input_audio_transcription.language).toBe(language);
  });
  it.each(["rate","language","model","vad"])("rejects mismatched %s ACK before audio",async field=>{
    const t=setup(s=>{s.autoSetup=false;s.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>s.receive({type:"session.updated",session:{id:"s",model:field==="model"?"wrong":s.model,modalities:["text"],...e.session,
      ...(field==="rate"?{sample_rate:24000}:{}),...(field==="language"?{input_audio_transcription:{language:"zh"}}:{}),...(field==="vad"?{turn_detection:{type:"server_vad"}}:{})}}));};});
    await expect(t.create().createSession(session)).rejects.toThrow();expect(t.record).not.toHaveBeenCalled();expect(t.sockets[0].sent).toHaveLength(1);
  });
  it("rejects 24k configuration or unsupported language before opening the socket",()=>{
    const t=setup();t.options.snapshot.components.asr!.sampleRate=24000;expect(t.create).toThrow();t.options.snapshot.components.asr!.sampleRate=16000;
    t.options.authorization.languagePolicy.source="zh-Hant";expect(t.create).toThrow("language_not_supported");expect(t.socketFactory).not.toHaveBeenCalled();
  });
  it("rejects missing or altered provenance instead of relabelling PCM",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);await expect(p.transcribe({...frame()})).rejects.toThrow("audio_invalid");expect(t.record).not.toHaveBeenCalled();
  });
  it("continues across nonoverlapping committed turns and preserves 16k timestamps",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);await p.transcribe(frame());await p.flush(session.sessionId);await p.transcribe(frame(2));const r=await p.commitBoundary({sessionId:session.sessionId,boundaryMs:200});
    expect(r?.timing).toMatchObject({startMs:100,endMs:200});expect(t.sockets).toHaveLength(1);
  });
  it("does not infer on close or retry a timed-out commit",async()=>{
    vi.useFakeTimers();const t=setup(s=>s.autoComplete=false),p=t.create();await p.createSession(session);await p.transcribe(frame());
    const check=expect(p.flush(session.sessionId)).rejects.toThrow();await vi.advanceTimersByTimeAsync(501);await check;
    await p.closeSession(session.sessionId);expect(t.sockets[0].sent.filter(e=>e.type==="input_audio_buffer.commit")).toHaveLength(1);expect(t.sockets[0].sent.some(e=>e.type==="session.finish")).toBe(false);
    expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it.each(["language","prefix","item","early_final"])("refuses %s result corruption",async kind=>{
    const t=setup(s=>{s.autoComplete=false;s.onSend=e=>{if(e.type!=="input_audio_buffer.commit")return;queueMicrotask(()=>{
      s.receive({type:"input_audio_buffer.committed",item_id:"item",previous_item_id:""});s.partial("item","Bon","");
      if(kind==="prefix")s.partial("item","Other","");
      else s.receive({type:"conversation.item.input_audio_transcription.completed",item_id:kind==="item"?"wrong":"item",language:kind==="language"?"zh":"fr",content_index:kind==="early_final"?1:0,transcript:"Bonjour"});
    });};});const p=t.create();await p.createSession(session);await p.transcribe(frame());await expect(p.flush(session.sessionId)).rejects.toThrow();expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
});
