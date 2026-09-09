import {afterEach,describe,expect,it,vi} from "vitest";
import type {PublicModelAttemptEvent,TranslationEvent} from "@translation/contracts";
import {pcm16Wav} from "../speaker/recent-pcm-audio-buffer.js";
import {configuredPublicTts,type ConfiguredPublicTtsOptions} from "./configured-public-tts.js";
import type {HttpTtsSynthesizer} from "./http-tts-synthesizer.js";
import {googleLinear16Pcm} from "./google-speech.js";
const active:HttpTtsSynthesizer[]=[];
const event=():TranslationEvent=>({type:"translation.final",sessionId:"tts-session",segmentId:"seg",revision:1,language:"ja",text:"こんにちは。"});
function setup(){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"public",reason:"online_selected",scopeKey:"tts"}} as const;
  const record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),resolveCredentials=vi.fn(async()=>({accessToken:"SYNTHETIC_TOKEN",accessTokenExpiresAt:Date.now()+3600000,quotaProjectId:"project"}));
  const fetchFn=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response(JSON.stringify({audioContent:pcm16Wav(Buffer.alloc(1920),24000).toString("base64")}),{headers:{"content-type":"application/json"}}));
  const options:ConfiguredPublicTtsOptions={sessionId:"tts-session",leaseId:"lease",deploymentId:"public",prefillMs:20,
    snapshot:{deploymentId:"public",configurationRevision:1,configurationHash:"a".repeat(64),modelPolicyRevision:"policy",executionPlan:plan,
      components:{tts:{enabled:true,vendor:"google",protocol:"google_cloud_tts",authKind:"google_service_account",endpoint:"https://synthetic.invalid/v1",projectId:"project",modelId:"service:google_cloud_tts",voice:"ja-JP-Standard-A",timeoutMs:500,sampleRate:24000}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"en",target:"ja",autoReverse:false,revision:1},syncPermission:{allowed:false}},record,resolveCredentials,fetchFn};
  const create=()=>{const s=configuredPublicTts(options);active.push(s);return s;};return {options,record,resolveCredentials,fetchFn,create};
}
async function collect(s:HttpTtsSynthesizer,e=event()){const audio=[];for await(const a of s.synthesizeStream(e))audio.push(a);return audio;}
afterEach(()=>{for(const s of active.splice(0))s.closeSession("tts-session");vi.restoreAllMocks();vi.useRealTimers();});
describe("Google Cloud TTS in original public synthesizer",()=>{
  it.each([16000,24000] as const)("sends manual voice/locale, decodes WAV and preserves %i PCM",async rate=>{
    const t=setup();t.options.snapshot.components.tts!.sampleRate=rate;
    t.fetchFn.mockImplementation(async()=>{expect(t.record.mock.calls[0][0].state).toBe("dispatching");return new Response(JSON.stringify({audioContent:pcm16Wav(Buffer.alloc(1920),rate).toString("base64")}),{headers:{"content-type":"application/json"}});});
    const a=await collect(t.create());expect(a.every(x=>x.sampleRate===rate&&x.format==="pcm16")).toBe(true);
    expect(Buffer.concat(a.map(x=>Buffer.from(x.data,"base64")))).toEqual(Buffer.alloc(1920));
    const [url,init]=t.fetchFn.mock.calls[0];expect(url).toBe("https://synthetic.invalid/v1/text:synthesize");
    expect(JSON.parse(String(init?.body))).toEqual({input:{text:"こんにちは。"},voice:{languageCode:"ja-JP",name:"ja-JP-Standard-A"},audioConfig:{audioEncoding:"LINEAR16",sampleRateHertz:rate}});
    expect(init?.headers).toMatchObject({authorization:"Bearer SYNTHETIC_TOKEN","x-goog-user-project":"project"});expect(init?.redirect).toBe("error");
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({providerId:"google",state:"confirmed"});expect(t.record.mock.calls.at(-1)![0].metadata?.usage).toBeUndefined();
  });
  it.each([["en","en-US-Wavenet-A","en-US"],["fr","fr-FR-Standard-A","fr-FR"],["zh","cmn-CN-Standard-A","cmn-CN"],
    ["zh-Hant","cmn-TW-Standard-A","cmn-TW"],["yue","yue-HK-Standard-A","yue-HK"]])("binds %s to the selected %s",async(lang,voice,locale)=>{
    const t=setup();t.options.snapshot.components.tts!.voice=voice;t.options.authorization.languagePolicy={source:"ja",target:lang as any,autoReverse:false,revision:2};
    await collect(t.create(),{...event(),language:lang as any});expect(JSON.parse(String(t.fetchFn.mock.calls[0][1]?.body)).voice.languageCode).toBe(locale);
  });
  it.each(["https://synthetic.invalid","https://synthetic.invalid/v1/text:synthesize"])("accepts exact root or REST path %s",async endpoint=>{
    const t=setup();t.options.snapshot.components.tts!.endpoint=endpoint;await collect(t.create());expect(t.fetchFn.mock.calls[0][0]).toBe("https://synthetic.invalid/v1/text:synthesize");
  });
  it.each(["voice","language","script","project","endpoint","auth"])("rejects invalid %s before credential lookup",kind=>{
    const t=setup(),p=t.options.snapshot.components.tts!;if(kind==="voice")p.voice="Charon";if(kind==="language")p.voice="en-US-Standard-A";if(kind==="script")p.voice="cmn-Hant-TW-Standard-A";
    if(kind==="project")p.projectId="";if(kind==="endpoint")p.endpoint="https://synthetic.invalid/v1/audio/speech";if(kind==="auth")p.authKind="api_key";
    expect(t.create).toThrow();expect(t.resolveCredentials).not.toHaveBeenCalled();
  });
  it.each(["expired","quota","key"])("rejects %s credentials without intent or request",async kind=>{
    const t=setup();t.resolveCredentials.mockImplementation(async()=>kind==="key"?{apiKey:"SYNTHETIC"} as any:
      {accessToken:"SYNTHETIC",accessTokenExpiresAt:Date.now()+(kind==="expired"?100:3600000),quotaProjectId:kind==="quota"?"other":"project"});
    await expect(collect(t.create())).rejects.toThrow(/google_tts/);expect(t.fetchFn).not.toHaveBeenCalled();expect(t.record).not.toHaveBeenCalled();
  });
  it("enforces the 5000 UTF-8 byte limit separately from character count",async()=>{
    const t=setup();await expect(collect(t.create(),{...event(),text:"中".repeat(1667)})).rejects.toThrow("input_scope");expect(t.resolveCredentials).not.toHaveBeenCalled();
  });
  it.each([401,429,503])("records HTTP %i safely without retry",async status=>{
    const t=setup();t.fetchFn.mockResolvedValue(new Response("SECRET_BODY",{status}));await expect(collect(t.create())).rejects.toThrow("http_failed");
    expect(t.fetchFn).toHaveBeenCalledTimes(1);expect(t.record.mock.calls.at(-1)![0].state).toBe(status===503?"uncertain":"rejected");expect(JSON.stringify(t.record.mock.calls)).not.toContain("SECRET_BODY");
  });
  it("bounds a stalled body and cancels without late output",async()=>{
    vi.useFakeTimers();const t=setup();t.fetchFn.mockResolvedValue(new Response(new ReadableStream({start(){}}),{headers:{"content-type":"application/json"}}));
    const check=expect(collect(t.create())).rejects.toThrow("cancelled");await vi.advanceTimersByTimeAsync(501);await check;expect(t.fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");
  });
  it.each(["{}","not json",JSON.stringify({audioContent:"not base64"})])("rejects malformed Google payload %s",async body=>{
    const t=setup();t.fetchFn.mockResolvedValue(new Response(body,{headers:{"content-type":"application/json"}}));await expect(collect(t.create())).rejects.toThrow();
  });
  it.each(["riff_size","format","channels","rate","byte_rate","alignment","bits","data_size","missing_data"])("rejects invalid WAV %s instead of playing header noise",kind=>{
    const wav=pcm16Wav(Buffer.alloc(16),24000);
    if(kind==="riff_size")wav.writeUInt32LE(1,4);if(kind==="format")wav.writeUInt16LE(3,20);if(kind==="channels")wav.writeUInt16LE(2,22);
    if(kind==="rate")wav.writeUInt32LE(16000,24);if(kind==="byte_rate")wav.writeUInt32LE(1,28);if(kind==="alignment")wav.writeUInt16LE(1,32);
    if(kind==="bits")wav.writeUInt16LE(8,34);if(kind==="data_size")wav.writeUInt32LE(99,40);if(kind==="missing_data")wav.write("JUNK",36);
    expect(()=>googleLinear16Pcm(wav,24000)).toThrow("wav_invalid");
  });
  it("walks padded ancillary WAV chunks rather than assuming a 44-byte header",()=>{
    const original=pcm16Wav(Buffer.alloc(16),24000),junk=Buffer.alloc(10);junk.write("JUNK");junk.writeUInt32LE(1,4);
    const wav=Buffer.concat([original.subarray(0,36),junk,original.subarray(36)]);wav.writeUInt32LE(wav.length-8,4);
    expect(googleLinear16Pcm(wav,24000)).toEqual(Buffer.alloc(16));
  });
});
