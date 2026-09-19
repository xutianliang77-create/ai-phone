import {afterEach,describe,expect,it,vi} from "vitest";
import type {AudioFrame,PublicModelAttemptEvent} from "@translation/contracts";
import {ProviderRouter} from "../providers/provider-router.js";
import type {ConfiguredStreamingAsrOptions} from "./configured-public-asr.js";
import type {HttpAsrProvider} from "./http-asr-provider.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";
import {SyntheticQwenAsrSocket} from "./qwen-streaming-asr.test-support.js";

const session={sessionId:"qwen-asr",sourceLanguage:"fr" as const,targetLanguage:"en" as const};
function frame(sequence=1,startSample=(sequence-1)*1600,durationMs=100):AudioFrame{
  const samples=16000*durationMs/1000,f:AudioFrame={type:"audio.frame",sessionId:session.sessionId,sequence,
    timestampMs:1788883200000+startSample/16,format:"pcm16",sampleRate:16000,data:Buffer.alloc(samples*2).toString("base64")};
  markAcceptedAudioRange(f,{startSample,endSample:startSample+samples});return f;
}
function setup(configure?:(s:SyntheticQwenAsrSocket)=>void){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const sockets:SyntheticQwenAsrSocket[]=[],record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),authorizeConnection=vi.fn(async()=>{}),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_KEY"}));
  const socketFactory=vi.fn((url:string,_options:unknown)=>{const s=new SyntheticQwenAsrSocket();s.model=new URL(url).searchParams.get("model")!;configure?.(s);sockets.push(s);return s.asWebSocket();});
  const options:ConfiguredStreamingAsrOptions={deploymentId:"public",sessionId:session.sessionId,leaseId:"lease",record,authorizeConnection,resolveCredentials,socketFactory,
    snapshot:{deploymentId:"public",configurationRevision:1,modelPolicyRevision:"policy",executionPlan:plan,components:{asr:{enabled:true,vendor:"qwen",protocol:"qwen_asr_realtime",authKind:"api_key",endpoint:"wss://synthetic.invalid/api-ws/v1/realtime",modelId:"manual-asr",sampleRate:16000,timeoutMs:500}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"fr",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false}}};
  const create=()=>{const p=new ProviderRouter().createConfiguredStreamingAsrProvider(options);active.push(p);return p;};return {options,sockets,record,authorizeConnection,resolveCredentials,socketFactory,create};
}
const active:HttpAsrProvider[]=[];
afterEach(async()=>{for(const p of active.splice(0))await p.closeSession(session.sessionId);vi.useRealTimers();vi.restoreAllMocks();});
const serverVad={type:"server_vad",threshold:0,silence_duration_ms:400};

describe("Qwen ASR server-VAD wire on original shared streaming lifecycle",()=>{
  it("uses server VAD and omits the language hint for a qualified automatic zh/en route",async()=>{
    const t=setup();t.options.authorization.languagePolicy={source:"auto",target:"zh",autoReverse:true,pair:["zh","en"],revision:2};
    const p=t.create(),automatic={...session,sourceLanguage:"auto" as const,targetLanguage:"zh" as const,autoReverseTargetLanguage:true,languagePair:["zh","en"] as ["zh","en"]};
    await p.createSession(automatic);expect(t.sockets[0].sent[0].session).toEqual({input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:{},turn_detection:serverVad});
  });

  it("accepts an automatic ACK with omitted optional transcription fields but exact server VAD",async()=>{
    const t=setup(s=>{s.autoSetup=false;s.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>s.receive({type:"session.updated",session:{id:"qwen-session",model:s.model,modalities:["text"],input_audio_format:"pcm",sample_rate:16000,turn_detection:serverVad}}));};});
    t.options.authorization.languagePolicy={source:"auto",target:"zh",autoReverse:true,pair:["zh","en"],revision:2};
    await expect(t.create().createSession({...session,sourceLanguage:"auto",targetLanguage:"zh",autoReverseTargetLanguage:true,languagePair:["zh","en"]} as any)).resolves.toBeUndefined();
  });

  it("accepts Qwen's model echo with fixed language and exact server VAD",async()=>{
    const t=setup(s=>{s.autoSetup=false;s.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>s.receive({type:"session.updated",session:{id:"qwen-session",model:s.model,modalities:["text"],input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:{model:s.model,language:"fr"},turn_detection:serverVad}}));};});
    await expect(t.create().createSession(session)).resolves.toBeUndefined();
  });

  it("accepts Qwen's server-returned VAD response flags without weakening requested thresholds",async()=>{
    const t=setup(s=>{s.autoSetup=false;s.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>s.receive({type:"session.updated",session:{id:"qwen-session",model:s.model,modalities:["text"],...e.session,
      turn_detection:{...serverVad,create_response:true,interrupt_response:true}}}));};});
    await expect(t.create().createSession(session)).resolves.toBeUndefined();
  });

  it("uses provider-confirmed automatic language only within the qualified pair",async()=>{
    const t=setup(s=>{s.detectedLanguage="zh";});t.options.authorization.languagePolicy={source:"auto",target:"zh",autoReverse:true,pair:["zh","en"],revision:2};
    const p=t.create(),automatic={...session,sourceLanguage:"auto" as const,targetLanguage:"zh" as const,autoReverseTargetLanguage:true,languagePair:["zh","en"] as ["zh","en"]};
    await p.createSession(automatic);await expect(p.transcribe(frame())).resolves.toMatchObject({language:"zh",text:"Bonjour tout le monde."});
  });

  it("rejects a Qwen automatic language outside the signed pair",async()=>{
    const t=setup(s=>{s.detectedLanguage="ja";});t.options.authorization.languagePolicy={source:"auto",target:"zh",autoReverse:true,pair:["zh","en"],revision:2};
    const p=t.create(),automatic={...session,sourceLanguage:"auto" as const,targetLanguage:"zh" as const,autoReverseTargetLanguage:true,languagePair:["zh","en"] as ["zh","en"]};
    await p.createSession(automatic);await expect(p.transcribe(frame())).rejects.toThrow();
  });

  it("emits cumulative drafts and a durable final without client commit",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);const partial:string[]=[];p.setPartialListener(session.sessionId,e=>partial.push(e.text));
    const result=await p.transcribe(frame());expect(partial).toEqual(["Bonjur","Bonjour tout le monde."]);expect(result).toMatchObject({text:"Bonjour tout le monde.",language:"fr",timing:{startMs:0,endMs:100}});
    expect(t.sockets[0].sent.map(e=>e.type)).toEqual(["session.update","input_audio_buffer.append"]);
    const events=t.record.mock.calls.map(c=>c[0]);expect(events.map(e=>e.state)).toEqual(["dispatching","confirmed"]);expect(new Set(events.map(e=>e.attemptId)).size).toBe(1);
  });

  it("keeps phone boundaries advisory and never sends Manual commit",async()=>{
    const t=setup(s=>s.autoComplete=false),p=t.create();await p.createSession(session);await p.transcribe(frame());
    await expect(p.commitBoundary({sessionId:session.sessionId,boundaryMs:100})).resolves.toBeNull();
    expect(t.sockets[0].sent.map(e=>e.type)).not.toContain("input_audio_buffer.commit");expect(t.sockets[0].sent.map(e=>e.type)).not.toContain("session.finish");
  });

  it("finishes the supplier session only for product-session finalization",async()=>{
    const t=setup(s=>s.autoComplete=false),p=t.create();await p.createSession(session);await p.transcribe(frame());
    const result=await p.flush(session.sessionId,{finishSession:true});expect(result).toMatchObject({text:"Bonjour tout le monde.",timing:{startMs:0,endMs:100}});
    expect(t.sockets[0].sent.map(e=>e.type)).toEqual(["session.update","input_audio_buffer.append","session.finish"]);
    await p.closeSession(session.sessionId);expect(t.record.mock.calls.at(-1)![0].state).toBe("confirmed");
  });

  it("persists a server-VAD tail emitted after the first final and before session.finished",async()=>{
    const t=setup(s=>s.tailOnFinish=true),p=t.create();await p.createSession(session);
    await expect(p.transcribe(frame(1,0,200))).resolves.toMatchObject({text:"Bonjour tout le monde.",timing:{startMs:0,endMs:200}});
    const tail=await p.flush(session.sessionId,{finishSession:true});
    expect(tail).toMatchObject({text:"Bonjour tout le monde.",timing:{startMs:100,endMs:200}});
    const events=t.record.mock.calls.map(call=>call[0]);
    expect(events.filter(event=>event.state==="dispatching")).toHaveLength(2);
    expect(events.filter(event=>event.state==="confirmed")).toHaveLength(2);
    expect(events.every(event=>event.state!=="uncertain")).toBe(true);
  });

  it("continues for 100 seconds across server-VAD turns on one product session",async()=>{
    const t=setup(s=>s.autoComplete=false),p=t.create();await p.createSession(session);let start=0;const finals:any[]=[];
    for(let n=1;n<=5;n++){const value=await p.transcribe(frame(n,start,20000));if(value)finals.push(...(Array.isArray(value)?value:[value]));start+=320000;t.sockets[0].complete();}
    const tail=await p.flush(session.sessionId);if(tail)finals.push(...(Array.isArray(tail)?tail:[tail]));
    expect(finals).toHaveLength(5);expect(finals.map(x=>x.timing)).toEqual([0,20,40,60,80].map(startSeconds=>({startMs:startSeconds*1000,endMs:(startSeconds+20)*1000,source:"estimated"})));
    expect(t.socketFactory).toHaveBeenCalledTimes(1);expect(t.sockets[0].sent.filter(e=>e.type==="input_audio_buffer.commit")).toHaveLength(0);
    expect(t.record.mock.calls.filter(c=>c[0].state==="confirmed")).toHaveLength(5);await p.flush(session.sessionId,{finishSession:true});
  });

  it("keeps one uninterrupted server-VAD utterance beyond the former 30 second client cap",async()=>{
    const t=setup(s=>s.autoComplete=false),p=t.create();await p.createSession(session);let start=0;
    for(let n=1;n<=4;n++){expect(await p.transcribe(frame(n,start,10000))).toBeNull();start+=160000;}
    t.sockets[0].complete();const result=await p.flush(session.sessionId);
    expect(result).toMatchObject({text:"Bonjour tout le monde.",timing:{startMs:0,endMs:40000}});
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({state:"confirmed",audioStartSample:0,audioEndSample:640000});
  });

  it.each(["zh","yue","en","ja","de","ko","ru","fr","pt","ar","it","es","hi","id","th","tr","uk","vi","cs","ms","pl"])("forwards supported source %s without fixed Chinese",async language=>{
    const t=setup();t.options.authorization.languagePolicy={source:language as any,target:language==="en"?"fr":"en",autoReverse:false,revision:2};
    await t.create().createSession({...session,sourceLanguage:language as any});expect(t.sockets[0].sent[0].session.input_audio_transcription.language).toBe(language);
  });

  it.each(["rate","language","model","vad","silence"])('rejects mismatched %s ACK before audio',async field=>{
    const t=setup(s=>{s.autoSetup=false;s.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>s.receive({type:"session.updated",session:{id:"qwen-session",model:field==="model"?"wrong":s.model,modalities:["text"],...e.session,
      ...(field==="rate"?{sample_rate:24000}:{}),...(field==="language"?{input_audio_transcription:{language:"zh"}}:{}),
      ...(field==="vad"?{turn_detection:null}:{}),...(field==="silence"?{turn_detection:{...serverVad,silence_duration_ms:800}}:{})}}));};});
    await expect(t.create().createSession(session)).rejects.toThrow();expect(t.record).not.toHaveBeenCalled();
  });

  it("rejects 24k configuration, unsupported language and discontinuous trusted audio",async()=>{
    const t=setup();t.options.snapshot.components.asr!.sampleRate=24000;expect(t.create).toThrow();t.options.snapshot.components.asr!.sampleRate=16000;
    t.options.authorization.languagePolicy.source="zh-Hant";expect(t.create).toThrow("language_not_supported");
    const u=setup(),p=u.create();await p.createSession(session);await expect(p.transcribe({...frame(),sequence:-1})).rejects.toThrow();
  });

  it.each(["language","prefix","item","early_final"])("refuses %s result corruption",async kind=>{
    const t=setup(s=>{s.autoComplete=false;s.onSend=e=>{if(e.type!=="input_audio_buffer.append")return;queueMicrotask(()=>{
      const item="item-bad";s.receive({type:"input_audio_buffer.speech_started",audio_start_ms:0,item_id:item});s.receive({type:"input_audio_buffer.speech_stopped",audio_end_ms:100,item_id:item});
      s.receive({type:"input_audio_buffer.committed",item_id:item,previous_item_id:""});s.receive({type:"conversation.item.created",item:{id:item,type:"message",role:"user",content:[{type:"input_audio",transcript:null}]}});
      s.receive({type:"conversation.item.input_audio_transcription.text",item_id:item,content_index:0,language:"fr",text:"Bon",stash:"jour"});
      if(kind==="prefix")s.receive({type:"conversation.item.input_audio_transcription.text",item_id:item,content_index:0,language:"fr",text:"Other",stash:""});
      else s.receive({type:"conversation.item.input_audio_transcription.completed",item_id:kind==="item"?"wrong":item,content_index:kind==="early_final"?1:0,language:kind==="language"?"zh":"fr",transcript:"Bonjour"});
    });};}),p=t.create();await p.createSession(session);await expect(p.transcribe(frame())).rejects.toThrow();
    expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });

  it("discards supplier error text and bounds a missing session.finished",async()=>{
    const bad=setup(s=>{s.autoComplete=false;s.onSend=e=>{if(e.type==="input_audio_buffer.append")queueMicrotask(()=>s.receive({type:"error",error:{message:"SECRET_PROVIDER_ERROR"}}));};}),p=bad.create();
    await p.createSession(session);await expect(p.transcribe(frame())).rejects.toThrow();expect(JSON.stringify(bad.record.mock.calls)).not.toContain("SECRET_PROVIDER_ERROR");
    vi.useFakeTimers();const timeout=setup(s=>{s.autoComplete=false;s.autoFinish=false;}),q=timeout.create();await q.createSession(session);await q.transcribe(frame());
    const pending=q.flush(session.sessionId,{finishSession:true}),check=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(501);await check;
    expect(timeout.sockets[0].sent.filter(e=>e.type==="session.finish")).toHaveLength(1);
  });

  it("closing without product finalization never invents a final result",async()=>{
    const t=setup(s=>s.autoComplete=false),p=t.create();await p.createSession(session);await p.transcribe(frame());await p.closeSession(session.sessionId);
    expect(t.sockets[0].sent.map(e=>e.type)).not.toContain("session.finish");expect(t.record.mock.calls.at(-1)![0]).toMatchObject({state:"uncertain",failureCode:"public_asr_stream_interrupted"});
  });
});
