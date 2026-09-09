import {afterEach,describe,it,expect,vi} from "vitest";
import {ProviderRouter} from "../providers/provider-router.js";
import type {ConfiguredPublicAsrOptions} from "./configured-public-asr.js";
import {parseOpenAiAsr,parseQwenCompletedAsr,type CompletedAsrAudio} from "./public-asr-completed-audio.js";
import {configuredStreamingAsr} from "./configured-public-asr.js";
const audio=():CompletedAsrAudio=>({sessionId:"session",segmentId:"turn",revision:1,complete:true,pcm:new Uint8Array(32000),sampleRate:16000,startSample:16000,sourceLanguage:"fr"});
function setup(){
  const plan={asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}} as const;
  const fetchFn=vi.fn(async()=>new Response(JSON.stringify({text:"Bonjour",usage:{type:"duration",seconds:1.1}}),{headers:{"x-request-id":"synthetic-asr"}})),record=vi.fn(async()=>{}),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_KEY"}));
  const options:ConfiguredPublicAsrOptions={deploymentId:"public-test",snapshot:{deploymentId:"public-test",configurationRevision:1,modelPolicyRevision:"policy",executionPlan:plan,
    components:{asr:{enabled:true,vendor:"openai",protocol:"openai_transcriptions",authKind:"api_key",endpoint:"https://synthetic.invalid/v1",modelId:"manual-asr",timeoutMs:1000,sampleRate:16000}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},executionPlan:plan,syncPermission:{allowed:false}},
    sessionId:"session",leaseId:"lease",resolveCredentials,record,fetchFn};
  return {options,fetchFn,record,resolveCredentials,client:()=>new ProviderRouter().createConfiguredAsrClient(options)};
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe("original HTTP ASR client finalized-audio public branch",()=>{
  it("encodes exact PCM via the existing WAV encoder, sends multipart, and journals its sample range",async()=>{
    const s=setup(),a=audio();a.pcm[0]=32;const result=await s.client().transcribeCompletedAudio(a);
    const [url,init]=(s.fetchFn.mock.calls[0] as any);expect(url).toBe("https://synthetic.invalid/v1/audio/transcriptions");expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({authorization:"Bearer SYNTHETIC_KEY"});const form=init.body as FormData;
    expect(form.get("language")).toBe("fr");expect(form.get("model")).toBe("manual-asr");expect(form.get("response_format")).toBe("json");
    const file=form.get("file") as File,bytes=Buffer.from(await file.arrayBuffer());expect(file.name).toBe("turn.wav");expect(bytes.toString("ascii",0,4)).toBe("RIFF");
    expect(bytes.readUInt32LE(24)).toBe(16000);expect(bytes.readUInt16LE(22)).toBe(1);expect(bytes.readUInt16LE(34)).toBe(16);expect(bytes.subarray(44)).toEqual(Buffer.from(a.pcm));
    expect(result).toMatchObject({segmentId:"turn",text:"Bonjour",language:"fr",isFinal:true,timing:{startMs:1000,endMs:2000}});
    expect(s.record.mock.calls.map(c=>(c as any)[0].state)).toEqual(["dispatching","confirmed"]);
    expect((s.record.mock.calls[1] as any)[0]).toMatchObject({component:"asr",audioStartSample:16000,audioEndSample:32000,audioSampleRate:16000,metadata:{usage:{audioSeconds:1.1}}});
    expect(JSON.stringify(s.record.mock.calls)).not.toContain("Bonjour");expect(JSON.stringify(s.record.mock.calls)).not.toContain("SYNTHETIC_KEY");
  });
  it("does not confuse silence with an unsent or free call",async()=>{
    const s=setup();s.fetchFn.mockResolvedValue(new Response('{"text":""}'));expect(await s.client().transcribeCompletedAudio(audio())).toBeNull();
    expect((s.record.mock.calls[1] as any)[0].state).toBe("confirmed");expect((s.record.mock.calls[1] as any)[0].metadata).not.toHaveProperty("usage");
  });
  it.each([{complete:false},{pcm:new Uint8Array(0)},{pcm:new Uint8Array(3)},{sampleRate:24000},{startSample:-1},{sessionId:"other"},{sourceLanguage:"en"},
    {pcm:new Uint8Array(16000*2*31)}])("rejects invalid, incomplete or cross-session audio before credentials",async patch=>{
    const s=setup();await expect(s.client().transcribeCompletedAudio({...audio(),...patch} as CompletedAsrAudio)).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();expect(s.resolveCredentials).not.toHaveBeenCalled();
  });
  it.each(["auto","reverse"])("does not fabricate acoustic language detection for %s",mode=>{
    const s=setup();s.options.authorization.languagePolicy=mode==="auto"?{source:"auto",target:"ja",autoReverse:false,revision:1}:{source:"fr",target:"ja",autoReverse:true,pair:["fr","ja"],revision:1};
    expect(()=>s.client()).toThrow("language_detection_not_implemented");expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each(["protocol","deployment","policy"])("rejects wrong %s binding",key=>{
    const s=setup();if(key==="protocol")s.options.snapshot.components.asr!.protocol="openai_realtime_asr";if(key==="deployment")s.options.deploymentId="other";if(key==="policy")s.options.authorization.modelPolicyRevision="other";
    expect(()=>s.client()).toThrow("configuration_not_supported");
  });
  it.each(["https://synthetic.invalid","https://synthetic.invalid/v1/audio/transcriptions/"])("normalizes %s without duplicate suffix",async endpoint=>{
    const s=setup();s.options.snapshot.components.asr!.endpoint=endpoint;await s.client().transcribeCompletedAudio(audio());expect((s.fetchFn.mock.calls[0] as any)[0]).toBe("https://synthetic.invalid/v1/audio/transcriptions");
  });
  it("rejects credential failure and admission failure before sending audio",async()=>{
    const s=setup(),client=s.client();s.resolveCredentials.mockRejectedValueOnce(Error("SECRET"));await expect(client.transcribeCompletedAudio(audio())).rejects.toMatchObject({outcome:"not_sent"});
    s.record.mockRejectedValue(Error("revoked"));await expect(client.transcribeCompletedAudio(audio())).rejects.toMatchObject({code:"public_asr_attempt_record_failed",outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each([401,429,503])("records HTTP %i without retry or supplier body leakage",async status=>{
    const s=setup();s.fetchFn.mockResolvedValue(new Response("SECRET_ERROR",{status}));await expect(s.client().transcribeCompletedAudio(audio())).rejects.toMatchObject({outcome:status===503?"uncertain":"rejected"});
    expect(s.fetchFn).toHaveBeenCalledTimes(1);expect(JSON.stringify(s.record.mock.calls)).not.toContain("SECRET_ERROR");
  });
  it("cancels stalled body with no late transcript",async()=>{
    const s=setup(),c=new AbortController();let entered!:()=>void,cancelled=false;const ready=new Promise<void>(r=>entered=r);
    s.fetchFn.mockImplementation(async()=>{entered();return new Response(new ReadableStream({cancel(){cancelled=true;}}));});
    const pending=s.client().transcribeCompletedAudio(audio(),c.signal),check=expect(pending).rejects.toMatchObject({outcome:"uncertain"});await ready;await Promise.resolve();c.abort();await check;expect(cancelled).toBe(true);
  });
  it("bounds timeout and records uncertainty instead of an empty successful transcript",async()=>{
    vi.useFakeTimers();const s=setup();s.fetchFn.mockImplementation(()=>new Promise(()=>{}));const check=expect(s.client().transcribeCompletedAudio(audio())).rejects.toMatchObject({outcome:"uncertain"});
    await vi.advanceTimersByTimeAsync(1001);await check;expect((s.record.mock.calls[1] as any)[0].state).toBe("uncertain");
  });
  it("does not return success if final attempt persistence fails",async()=>{
    const s=setup();s.record.mockImplementation(async e=>{if((e as any).state==="confirmed")throw Error("db");});
    await expect(s.client().transcribeCompletedAudio(audio())).rejects.toMatchObject({outcome:"uncertain"});expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("preserves caller audio and configuration across asynchronous credential lookup",async()=>{
    const s=setup(),a=audio();let resolve!:(v:{apiKey:string})=>void;s.resolveCredentials.mockImplementation(()=>new Promise(r=>resolve=r));
    const client=s.client(),pending=client.transcribeCompletedAudio(a);await Promise.resolve();a.pcm.fill(99);s.options.snapshot.components.asr!.modelId="changed";resolve({apiKey:"SYNTHETIC_KEY"});await pending;
    const form=(s.fetchFn.mock.calls[0] as any)[1].body as FormData;expect(form.get("model")).toBe("manual-asr");expect(new Uint8Array(await (form.get("file") as File).arrayBuffer())[44]).toBe(0);
  });
  it("preserves token detail counts without estimating duration",()=>{
    expect(parseOpenAiAsr({text:"text",usage:{type:"tokens",input_tokens:10,output_tokens:4,total_tokens:14,input_token_details:{audio_tokens:8,text_tokens:2}}},null).metadata.usage)
      .toEqual({promptTokens:10,completionTokens:4,totalTokens:14,audioInputTokens:8,textInputTokens:2});
  });
  it("reuses original noise-marker and whitespace cleanup",()=>{
    expect(parseOpenAiAsr({text:"<noise>"},null).text).toBe("");expect(parseOpenAiAsr({text:"  Bonjour  \n monde "},null).text).toBe("Bonjour monde");
  });
  it.each([{text:123},{text:"ok",usage:{type:"duration",seconds:-1}},{text:"ok",usage:{type:"other"}},{text:"ok",usage:{type:"tokens",input_tokens:1}}])("rejects malformed output %j",value=>expect(()=>parseOpenAiAsr(value,null)).toThrow());
  it("does not probe or report qualification from a config-only client",async()=>{const s=setup();expect(await s.client().healthCheck()).toBe(false);expect(s.fetchFn).not.toHaveBeenCalled();});
});
const qwenResponse=()=>({id:"synthetic-qwen",model:"manual-qwen",choices:[{finish_reason:"stop",message:{role:"assistant",content:"Bonjour",
  annotations:[{type:"audio_info",language:"fr"}]}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,seconds:1.1,prompt_tokens_details:{audio_tokens:9,text_tokens:1}}});
function qwenSetup(){const s=setup();Object.assign(s.options.snapshot.components.asr!,{vendor:"qwen",protocol:"qwen_asr_compatible",modelId:"manual-qwen",endpoint:"https://synthetic.invalid/compatible-mode/v1"});
  s.fetchFn.mockResolvedValue(new Response(JSON.stringify(qwenResponse())));return s;}
describe("Qwen finalized audio through the original HTTP lifecycle",()=>{
  it.each([16000,24000] as const)("encodes exact %i Hz WAV, manual model and language with non-streaming input",async sampleRate=>{
    const s=qwenSetup(),a={...audio(),sampleRate,pcm:new Uint8Array(sampleRate*2)};s.options.snapshot.components.asr!.sampleRate=sampleRate;
    expect(await s.client().transcribeCompletedAudio(a)).toMatchObject({text:"Bonjour",language:"fr",isFinal:true});
    const [url,init]=s.fetchFn.mock.calls[0] as any;expect(url).toBe("https://synthetic.invalid/compatible-mode/v1/chat/completions");
    const b=JSON.parse(init.body),data=b.messages[0].content[0].input_audio.data;
    expect(b).toMatchObject({model:"manual-qwen",stream:false,asr_options:{language:"fr",enable_itn:false}});expect(b).not.toHaveProperty("stream_options");
    expect(data.startsWith("data:audio/wav;base64,")).toBe(true);const wav=Buffer.from(data.split(",")[1],"base64");
    expect(wav.readUInt32LE(24)).toBe(sampleRate);expect(wav.subarray(44)).toEqual(Buffer.from(a.pcm));expect(init.redirect).toBe("error");
    expect((s.record.mock.calls[1] as any)[0]).toMatchObject({providerId:"qwen",state:"confirmed",metadata:{requestId:"synthetic-qwen",reportedModel:"manual-qwen",
      usage:{promptTokens:10,completionTokens:2,totalTokens:12,audioSeconds:1.1,audioInputTokens:9,textInputTokens:1}}});
    expect(JSON.stringify(s.record.mock.calls)).not.toMatch(/Bonjour|SYNTHETIC_KEY|base64/);
  });
  it.each(["zh","en","yue"] as const)("passes the selected %s language without hardcoding",async language=>{
    const s=qwenSetup();s.options.authorization.languagePolicy.source=language;const b=qwenResponse();b.choices[0].message.annotations[0].language=language;
    s.fetchFn.mockResolvedValue(new Response(JSON.stringify(b)));await s.client().transcribeCompletedAudio({...audio(),sourceLanguage:language});
    expect(JSON.parse((s.fetchFn.mock.calls[0] as any)[1].body).asr_options.language).toBe(language);
  });
  it.each(["https://synthetic.invalid","https://synthetic.invalid/v1/chat/completions/"])("normalizes %s once",async endpoint=>{
    const s=qwenSetup();s.options.snapshot.components.asr!.endpoint=endpoint;await s.client().transcribeCompletedAudio(audio());
    expect((s.fetchFn.mock.calls[0] as any)[0]).toBe("https://synthetic.invalid/v1/chat/completions");
  });
  it("rejects a file protocol at the streaming factory without calling credentials",async()=>{
    const s=qwenSetup();expect(()=>configuredStreamingAsr({...s.options,authorizeConnection:async()=>{}})).toThrow("configuration_not_supported");
    expect(await s.client().healthCheck()).toBe(false);expect(s.resolveCredentials).not.toHaveBeenCalled();
    await expect(s.client().transcribeCompletedAudio({...audio(),complete:false} as any)).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each(["auto","reverse","unsupported"])("rejects %s language before dispatch",mode=>{
    const s=qwenSetup();if(mode==="auto")s.options.authorization.languagePolicy.source="auto";
    else if(mode==="reverse")s.options.authorization.languagePolicy={source:"fr",target:"ja",autoReverse:true,pair:["fr","ja"],revision:1};
    else s.options.authorization.languagePolicy.source="he";
    expect(()=>s.client()).toThrow();expect(s.fetchFn).not.toHaveBeenCalled();expect(s.resolveCredentials).not.toHaveBeenCalled();
  });
  it.each([401,429,503])("does not retry HTTP %i or expose provider errors",async status=>{
    const s=qwenSetup();s.fetchFn.mockResolvedValue(new Response("PRIVATE_ERROR",{status}));
    await expect(s.client().transcribeCompletedAudio(audio())).rejects.toMatchObject({outcome:status===503?"uncertain":"rejected"});
    expect(s.fetchFn).toHaveBeenCalledTimes(1);expect(JSON.stringify(s.record.mock.calls)).not.toContain("PRIVATE_ERROR");
  });
  it("cancels an in-flight request and does not return late text",async()=>{
    const s=qwenSetup(),c=new AbortController();let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
    s.fetchFn.mockImplementation(()=>{entered();return new Promise(()=>{});});
    const check=expect(s.client().transcribeCompletedAudio(audio(),c.signal)).rejects.toMatchObject({outcome:"uncertain"});await ready;c.abort();await check;
    expect((s.record.mock.calls.at(-1) as any)[0].state).toBe("uncertain");expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("requires durable intent before sending",async()=>{
    const s=qwenSetup();s.record.mockRejectedValue(Error("revoked"));await expect(s.client().transcribeCompletedAudio(audio())).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("keeps absent usage unknown and accepts confirmed silence",()=>{
    const b=qwenResponse();delete (b as any).usage;b.choices[0].message.content="<noise>";
    const parsed=parseQwenCompletedAsr(b,null,"fr");expect(parsed.text).toBe("");expect(parsed.metadata).not.toHaveProperty("usage");
  });
  it.each(["length","multiple","language","error","seconds","tokens","usage"])("rejects malformed %s output",kind=>{
    const b=qwenResponse();if(kind==="length")b.choices[0].finish_reason="length";if(kind==="multiple")b.choices.push(b.choices[0]);
    if(kind==="language")b.choices[0].message.annotations[0].language="en";if(kind==="error")(b as any).error={message:"PRIVATE"};
    if(kind==="seconds")b.usage.seconds=-1;if(kind==="tokens")b.usage.prompt_tokens=1.1;if(kind==="usage")(b as any).usage=null;
    expect(()=>parseQwenCompletedAsr(b,null,"fr")).toThrow();
  });
});
