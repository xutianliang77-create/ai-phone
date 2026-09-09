import {afterEach,describe,expect,it,vi} from "vitest";
import type {PublicModelAttemptEvent,ServerRealtimeEvent,TranslationEvent} from "@translation/contracts";
import {configuredPublicTts,type ConfiguredPublicTtsOptions} from "./configured-public-tts.js";
import {HttpTtsSynthesizer} from "./http-tts-synthesizer.js";
import {createConfiguredPublicTtsOutputQueue} from "./realtime-tts-output-factory.js";
const event=():TranslationEvent=>({type:"translation.final",sessionId:"tts-session",segmentId:"seg",revision:1,text:"こんにちは",language:"ja"});
const response=(bytes=1920,headers:Record<string,string>={})=>new Response(Buffer.alloc(bytes),{headers:{"content-type":"application/octet-stream","x-request-id":"synthetic-request",...headers}});
const active:HttpTtsSynthesizer[]=[];
function setup(){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"public",reason:"online_selected",scopeKey:"tts"}} as const;
  const record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),fetchFn=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>response()),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_KEY"}));
  const options:ConfiguredPublicTtsOptions={sessionId:"tts-session",leaseId:"lease",deploymentId:"public",prefillMs:20,
    snapshot:{deploymentId:"public",configurationRevision:1,configurationHash:"a".repeat(64),modelPolicyRevision:"policy",executionPlan:plan,
      components:{tts:{enabled:true,vendor:"openai",protocol:"openai_speech",authKind:"api_key",endpoint:"https://synthetic.invalid/v1",modelId:"manual-tts",voice:"coral",timeoutMs:500,sampleRate:24000}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},syncPermission:{allowed:false}},
    record,fetchFn,resolveCredentials};
  const create=()=>{const s=configuredPublicTts(options);active.push(s);return s;};
  return {options,record,fetchFn,resolveCredentials,create};
}
async function collect(s:HttpTtsSynthesizer,e=event(),voice?:Parameters<HttpTtsSynthesizer["synthesizeStream"]>[1]){const audio=[];for await(const a of s.synthesizeStream(e,voice))audio.push(a);return audio;}
afterEach(()=>{for(const s of active.splice(0))s.closeSession("tts-session");vi.useRealTimers();vi.restoreAllMocks();});
describe("configured public Speech on original synthesizer and queue",()=>{
  it("uses manual model/voice, exact target text and PCM, journaling before HTTP and after EOF",async()=>{
    const t=setup(),s=t.create();expect(s).toBeInstanceOf(HttpTtsSynthesizer);expect(t.resolveCredentials).not.toHaveBeenCalled();
    t.fetchFn.mockImplementation(async()=>{expect(t.record.mock.calls[0][0].state).toBe("dispatching");return response();});
    const audio=await collect(s);expect(audio.map(a=>a.sequence)).toEqual([1,2]);expect(audio.every(a=>a.sampleRate===24000&&a.format==="pcm16")).toBe(true);
    expect(Buffer.concat(audio.map(a=>Buffer.from(a.data,"base64")))).toEqual(Buffer.alloc(1920));
    const [url,init]=t.fetchFn.mock.calls[0];expect(url).toBe("https://synthetic.invalid/v1/audio/speech");
    expect(JSON.parse(String(init?.body))).toEqual({model:"manual-tts",voice:"coral",input:"こんにちは",response_format:"pcm"});
    expect(init?.redirect).toBe("error");expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(t.record.mock.calls.map(c=>c[0].state)).toEqual(["dispatching","confirmed"]);expect(t.record.mock.calls[1][0]).toMatchObject({component:"tts",metadata:{requestId:"synthetic-request"}});
    expect(t.record.mock.calls[1][0].metadata?.usage).toBeUndefined();expect(JSON.stringify(t.record.mock.calls)).not.toContain("こんにちは");
  });
  it.each([["https://synthetic.invalid","https://synthetic.invalid/v1/audio/speech"],["https://synthetic.invalid/custom/v2","https://synthetic.invalid/custom/v2/audio/speech"],
    ["https://synthetic.invalid/custom/audio/speech/","https://synthetic.invalid/custom/audio/speech"]])("preserves manual endpoint prefix %s",async(url,expected)=>{
    const t=setup();t.options.snapshot.components.tts!.endpoint=url;await collect(t.create());expect(t.fetchFn.mock.calls[0][0]).toBe(expected);
  });
  it("keeps split PCM samples aligned without assuming HTTP chunk boundaries are audio frames",async()=>{
    const t=setup();t.fetchFn.mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3));c.enqueue(new Uint8Array(1917));c.close();}}),{headers:{"content-type":"audio/pcm"}}));
    const a=await collect(t.create());expect(a.every(v=>Buffer.from(v.data,"base64").length%2===0)).toBe(true);expect(a).toHaveLength(2);
  });
  it("does not resend or replay the same revision, and rejects conflicting contents",async()=>{
    const t=setup(),s=t.create();await collect(s);expect(await collect(s)).toEqual([]);expect(t.fetchFn).toHaveBeenCalledTimes(1);
    await expect(collect(s,{...event(),text:"変更"})).rejects.toThrow("revision_conflict");expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });
  it.each(["session","language","revision","length","voice"])("rejects invalid %s before credential lookup",async kind=>{
    const t=setup(),e=event();if(kind==="session")e.sessionId="other";if(kind==="language")e.language="en";if(kind==="revision")e.revision=-1;if(kind==="length")e.text="a".repeat(4097);
    await expect(collect(t.create(),e,kind==="voice"?{mode:"preset",presetId:"private-voice"}:undefined)).rejects.toThrow("input_scope");
    expect(t.resolveCredentials).not.toHaveBeenCalled();expect(t.fetchFn).not.toHaveBeenCalled();
  });
  it.each(["protocol","rate","mode","hash","endpoint","prefill"])("rejects unsupported configuration %s",kind=>{
    const t=setup(),p=t.options.snapshot.components.tts!;if(kind==="protocol")p.protocol="qwen_tts_realtime";if(kind==="rate")p.sampleRate=16000;
    if(kind==="mode")t.options.authorization.executionPlan={...t.options.authorization.executionPlan,tts:{execution:"disabled"}};
    if(kind==="hash")t.options.snapshot.configurationHash="wrong";if(kind==="endpoint")p.endpoint="http://private.invalid";if(kind==="prefill")t.options.prefillMs=0;
    expect(t.create).toThrow();expect(t.fetchFn).not.toHaveBeenCalled();
  });
  it("requires durable intent before sending and never emits PCM if the final journal fails",async()=>{
    const t=setup();t.record.mockRejectedValue(Error("private diagnostic"));await expect(collect(t.create())).rejects.toThrow("attempt_record_failed");expect(t.fetchFn).not.toHaveBeenCalled();
    const u=setup();u.fetchFn.mockResolvedValue(response(10));u.record.mockImplementation(async e=>{if(e.state==="confirmed")throw Error("store");});
    await expect(collect(u.create())).rejects.toThrow("attempt_record_failed");expect(u.record.mock.calls.map(c=>c[0].state)).toEqual(["dispatching","confirmed"]);
  });
  it.each([0,3])("rejects empty/odd PCM (%i bytes) as uncertain",async n=>{
    const t=setup();t.fetchFn.mockResolvedValue(response(n));await expect(collect(t.create())).rejects.toThrow("audio_incomplete");expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it.each(["application/json","audio/mpeg"])("never forwards %s as PCM",async mime=>{
    const t=setup();t.fetchFn.mockResolvedValue(response(10,{"content-type":mime}));await expect(collect(t.create())).rejects.toThrow("audio_format");
  });
  it("rejects truncated content length",async()=>{const t=setup();t.fetchFn.mockResolvedValue(response(10,{"content-length":"100"}));await expect(collect(t.create())).rejects.toThrow("audio_incomplete");});
  it.each([401,429,503])("sanitizes HTTP %i and does not retry",async status=>{
    const t=setup();t.fetchFn.mockResolvedValue(new Response("SECRET_PROVIDER_BODY",{status}));await expect(collect(t.create())).rejects.toThrow("public_tts_http_failed");
    expect(t.fetchFn).toHaveBeenCalledTimes(1);expect(t.record.mock.calls.at(-1)![0].state).toBe(status===503?"uncertain":"rejected");expect(JSON.stringify(t.record.mock.calls)).not.toContain("SECRET");
  });
  it("bounds stalled response bodies and aborts the real transport signal",async()=>{
    vi.useFakeTimers();const t=setup();t.fetchFn.mockResolvedValue(new Response(new ReadableStream({start(){}}),{headers:{"content-type":"audio/pcm"}}));
    const check=expect(collect(t.create())).rejects.toThrow("cancelled");await vi.advanceTimersByTimeAsync(501);await check;
    expect(t.fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it("stops a consumer after a prefix without declaring full synthesis confirmed",async()=>{
    const t=setup(),s=t.create(),iterator=s.synthesizeStream(event())[Symbol.asyncIterator]();expect((await iterator.next()).done).toBe(false);
    await iterator.return?.();expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it("bounds stalled credentials before intent or network",async()=>{
    vi.useFakeTimers();const t=setup();t.resolveCredentials.mockImplementation(()=>new Promise(()=>{}));
    const check=expect(collect(t.create())).rejects.toThrow("cancelled");await vi.advanceTimersByTimeAsync(501);await check;
    expect(t.record).not.toHaveBeenCalled();expect(t.fetchFn).not.toHaveBeenCalled();
  });
  it("freezes event identity during credential lookup and refuses work after close",async()=>{
    const t=setup();let release!:(c:{apiKey:string})=>void;t.resolveCredentials.mockImplementation(()=>new Promise(r=>release=r));
    const e=event(),s=t.create(),pending=collect(s,e);await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
    e.sessionId="other";e.text="mutated";release({apiKey:"SYNTHETIC_KEY"});const a=await pending;
    expect(a.every(c=>c.sessionId==="tts-session")).toBe(true);expect(JSON.parse(String(t.fetchFn.mock.calls[0][1]?.body)).input).toBe("こんにちは");
    s.closeSession("tts-session");await expect(collect(s)).rejects.toThrow("closed");expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("runs through the original queue once and returns nonretryable, sanitized synthesis errors",async()=>{
    const t=setup();t.fetchFn.mockResolvedValue(new Response("SECRET",{status:503}));const q=createConfiguredPublicTtsOutputQueue(t.options,()=>true),events:ServerRealtimeEvent[]=[];
    q.enqueue(event(),e=>events.push(e));await q.drain();expect(events).toHaveLength(1);expect(events[0]).toMatchObject({type:"error",stage:"tts",retryable:false});expect(JSON.stringify(events)).not.toContain("SECRET");q.close();
  });
  it("cancels a pending public fetch when reading is disabled and suppresses late audio",async()=>{
    const t=setup();let release!:(r:Response)=>void;t.fetchFn.mockImplementation(()=>new Promise(r=>release=r));
    const q=createConfiguredPublicTtsOutputQueue(t.options,()=>true),events:ServerRealtimeEvent[]=[];q.enqueue(event(),e=>events.push(e));
    await vi.waitFor(()=>expect(release).toBeTypeOf("function"));q.setVoiceOutput(false);expect(t.fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    release(response());await vi.waitFor(()=>expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain"));expect(events).toEqual([]);q.close();
  });
});
