import {afterEach,describe,expect,it,vi} from "vitest";
import type {PublicModelAttemptEvent,TranslationEvent} from "@translation/contracts";
import {configuredPublicTts,type ConfiguredPublicTtsOptions} from "./configured-public-tts.js";
import type {HttpTtsSynthesizer} from "./http-tts-synthesizer.js";
import {SyntheticQwenSpeechSocket} from "./qwen-speech.test-support.js";
const active:HttpTtsSynthesizer[]=[];
function setup(configure?:(ws:SyntheticQwenSpeechSocket)=>void){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"public",reason:"online_selected",scopeKey:"tts"}} as const;
  const record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_QWEN"})),sockets:SyntheticQwenSpeechSocket[]=[];
  const socketFactory=vi.fn((url:string,_options:unknown)=>{const ws=new SyntheticQwenSpeechSocket();ws.model=new URL(url).searchParams.get("model")!;configure?.(ws);sockets.push(ws);return ws.asWebSocket();});
  const options:ConfiguredPublicTtsOptions={sessionId:"tts-session",leaseId:"lease",deploymentId:"public",prefillMs:20,
    snapshot:{deploymentId:"public",configurationRevision:1,configurationHash:"a".repeat(64),modelPolicyRevision:"policy",executionPlan:plan,
      components:{tts:{enabled:true,vendor:"qwen",protocol:"qwen_tts_realtime",authKind:"api_key",endpoint:"wss://synthetic.invalid/api-ws/v1/realtime",modelId:"manual-tts",voice:"Cherry",timeoutMs:500,sampleRate:24000}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},syncPermission:{allowed:false}},record,resolveCredentials,socketFactory};
  const create=()=>{const s=configuredPublicTts(options);active.push(s);return s;};
  return {options,record,resolveCredentials,socketFactory,sockets,create};
}
const event=(language="ja"):TranslationEvent=>({type:"translation.final",sessionId:"tts-session",segmentId:"seg",revision:1,text:"こんにちは",language:language as TranslationEvent["language"]});
async function collect(s:HttpTtsSynthesizer,e=event()){const a=[];for await(const x of s.synthesizeStream(e))a.push(x);return a;}
afterEach(()=>{for(const s of active.splice(0))s.closeSession("tts-session");vi.useRealTimers();vi.restoreAllMocks();});
describe("Qwen wire inside original public TTS lifecycle",()=>{
  it("waits for exact configuration, commits once and confirms only after full response and finish",async()=>{
    const s=setup(ws=>ws.onSend=e=>{if(e.type==="input_text_buffer.append")expect(s.record.mock.calls[0][0].state).toBe("dispatching");});
    const a=await collect(s.create());expect(a).toHaveLength(2);expect(a.map(x=>x.sequence)).toEqual([1,2]);
    const [url,opts]=s.socketFactory.mock.calls[0];expect(new URL(url).searchParams.get("model")).toBe("manual-tts");expect(opts).toMatchObject({headers:{Authorization:"Bearer SYNTHETIC_QWEN"},followRedirects:false});
    const messages=s.sockets[0].sent;expect(messages.map(e=>e.type)).toEqual(["session.update","input_text_buffer.append","input_text_buffer.commit","session.finish"]);
    expect(messages[0].session).toEqual({voice:"Cherry",mode:"commit",language_type:"Japanese",response_format:"pcm",sample_rate:24000});
    expect(new Set(messages.map(e=>e.event_id)).size).toBe(4);
    expect(s.record.mock.calls.at(-1)![0]).toMatchObject({component:"tts",providerId:"qwen",state:"confirmed",metadata:{requestId:"response-qwen",reportedModel:"manual-tts",usage:{billedCharacters:12}}});expect(s.sockets[0].readyState).toBe(3);
  });
  it.each([["zh","Chinese"],["en","English"],["de","German"],["it","Italian"],["pt","Portuguese"],["es","Spanish"],["ko","Korean"],["fr","French"],["ru","Russian"]])("maps %s explicitly to %s",async(lang,expected)=>{
    const s=setup();s.options.authorization.languagePolicy={source:lang==="fr"?"en":"fr",target:lang as any,autoReverse:false,revision:2};await collect(s.create(),event(lang));expect(s.sockets[0].sent[0].session.language_type).toBe(expected);
  });
  it("refuses unsupported language and wrong endpoint scheme without socket or credential work",()=>{
    const s=setup();s.options.authorization.languagePolicy.target="ar";expect(s.create).toThrow("language_not_supported");expect(s.resolveCredentials).not.toHaveBeenCalled();
    s.options.authorization.languagePolicy.target="ja";s.options.snapshot.components.tts!.endpoint="https://synthetic.invalid";expect(s.create).toThrow("configuration");expect(s.socketFactory).not.toHaveBeenCalled();
  });
  it.each(["voice","language_type","mode","sample_rate","model"])("rejects a changed %s configuration acknowledgement before text",async field=>{
    const s=setup(ws=>{ws.autoSetup=false;ws.onSend=e=>{if(e.type==="session.update")queueMicrotask(()=>ws.receive({type:"session.updated",session:{id:"s",model:ws.model,...e.session,[field]:"wrong"}}));};});
    await expect(collect(s.create())).rejects.toThrow("protocol_failed");expect(s.sockets[0].sent).toHaveLength(1);expect(s.record.mock.calls.at(-1)![0].state).toBe("not_sent");
  });
  it.each(["early_close","missing_finish","missing_setup"])("bounds %s without retry",async kind=>{
    vi.useFakeTimers();const s=setup(ws=>{if(kind==="missing_finish")ws.autoFinish=false;if(kind==="missing_setup")ws.autoSetup=false;
      if(kind==="early_close"){ws.autoAudio=false;ws.onSend=e=>{if(e.type==="input_text_buffer.commit")queueMicrotask(()=>ws.terminate());};}});
    const check=expect(collect(s.create())).rejects.toThrow();await vi.advanceTimersByTimeAsync(501);await check;expect(s.socketFactory).toHaveBeenCalledTimes(1);
    expect(s.record.mock.calls.at(-1)![0].state).toBe(kind==="missing_setup"?"not_sent":"uncertain");
  });
  it.each(["wrong_item","audio_before_response","bad_base64","error_body","bad_usage"])("rejects %s and does not leak raw provider data",async kind=>{
    const s=setup(ws=>{if(kind==="bad_usage"){ws.usage={characters:-1};return;}
      if(kind==="wrong_item"||kind==="bad_base64"){ws.audio=()=>ws.receive({type:"response.audio.delta",response_id:"response-qwen",item_id:kind==="wrong_item"?"wrong":"item-qwen",output_index:0,content_index:0,delta:kind==="bad_base64"?"not-base64":"AAA="});return;}
      ws.autoAudio=false;ws.onSend=e=>{if(e.type==="input_text_buffer.commit")queueMicrotask(()=>kind==="error_body"?ws.receive({type:"error",error:{message:"SECRET"}}):ws.audio());};});
    await expect(collect(s.create())).rejects.toThrow(/qwen_tts/);expect(s.record.mock.calls.at(-1)![0].state).toBe("uncertain");expect(JSON.stringify(s.record.mock.calls)).not.toContain("SECRET");
  });
  it.each([undefined,{total_tokens:10,input_tokens:3,output_tokens:7,input_tokens_details:{text_tokens:3},output_tokens_details:{audio_tokens:7}}])("preserves absent or token usage without deriving fees",async usage=>{
    const s=setup(ws=>ws.usage=usage);await collect(s.create());const u=s.record.mock.calls.at(-1)![0].metadata?.usage;
    if(usage===undefined)expect(u).toBeUndefined();else expect(u).toMatchObject({totalTokens:10,promptTokens:3,completionTokens:7,textInputTokens:3,audioOutputTokens:7});
  });
  it("refuses overflowing event audio backlog",async()=>{
    const s=setup(ws=>{ws.audio=()=>{for(let n=0;n<4;n++)ws.receive({type:"response.audio.delta",response_id:"response-qwen",item_id:"item-qwen",output_index:0,content_index:0,delta:Buffer.alloc(160000).toString("base64")});};});
    await expect(collect(s.create())).rejects.toThrow("protocol_failed");expect(s.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it("cancels generation after a prefix without confirming or reconnecting",async()=>{
    const s=setup(ws=>ws.autoFinish=false),synth=s.create(),iterator=synth.synthesizeStream(event())[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);synth.cancelSession("tts-session");await iterator.return?.();expect(s.sockets[0].readyState).toBe(3);expect(s.record.mock.calls.at(-1)![0].state).toBe("uncertain");
    expect(await collect(synth)).toEqual([]);expect(s.socketFactory).toHaveBeenCalledTimes(1);
  });
});
