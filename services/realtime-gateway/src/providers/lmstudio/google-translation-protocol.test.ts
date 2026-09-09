import {afterEach,describe,it,expect,vi} from "vitest";
import {LmStudioClient,type LmStudioClientOptions} from "./lmstudio-client.js";
import {parseGoogleTranslation} from "./google-translation-protocol.js";
import {ProviderRouter} from "../provider-router.js";
import type {ConfiguredPublicTranslationOptions} from "./configured-public-translation.js";
const input={text:"Bonjour",sourceLanguage:"fr",targetLanguage:"ja",attemptContext:{segmentId:"seg",revision:2}};
function payload(){return {responseId:"google-response",modelVersion:"manual-model-v2",candidates:[{finishReason:"STOP",content:{role:"model",parts:[{text:"こんにちは"}]}}],
  usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,thoughtsTokenCount:5,cachedContentTokenCount:2,totalTokenCount:18}};}
function setup(google:LmStudioClientOptions["google"]={protocol:"gemini"}){
  const record=vi.fn(async()=>{}),fetchFn=vi.fn(async()=>new Response(JSON.stringify(payload())));
  const options:LmStudioClientOptions={baseUrl:"https://synthetic.invalid",model:"manual-model",apiKey:"SYNTHETIC_API_KEY",transportProfile:"public_google",google,
    timeoutMs:1000,maxTokens:345,fetchFn,attemptRecorder:{sessionId:"session",leaseId:"lease",providerId:"google",record}};
  return {options,fetchFn,record,client:()=>new LmStudioClient(options)};
}
function factory(vertex=false){
  const s=setup(),plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const resolve=vi.fn(async()=>vertex?{accessToken:"SYNTHETIC_TOKEN",accessTokenExpiresAt:Date.now()+60000}:{apiKey:"SYNTHETIC_API_KEY"});
  const opts:ConfiguredPublicTranslationOptions={deploymentId:"public-test",snapshot:{deploymentId:"public-test",configurationRevision:1,configurationHash:"a".repeat(64),modelPolicyRevision:"p",
    executionPlan:plan,components:{translation:{enabled:true,vendor:"google",protocol:vertex?"google_vertex_gemini":"google_gemini",authKind:vertex?"google_adc":"api_key",
      endpoint:"https://synthetic.invalid",modelId:"selected-model",timeoutMs:1000,maxTokens:345,projectId:"my-project",location:"global"}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"p",languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},executionPlan:plan,syncPermission:{allowed:false}},
    attemptRecorder:s.options.attemptRecorder!,resolveCredentials:resolve,fetchFn:s.fetchFn};
  return {...s,opts,resolve,create:()=>new ProviderRouter().createConfiguredTranslationClient(opts)};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("Google native wire profile on the original translation client",()=>{
  it.each([false,true])("uses native factory request with vertex=%s",async vertex=>{
    const s=factory(vertex);expect(await s.create().translate(input)).toBe("こんにちは");
    const [url,init]=(s.fetchFn.mock.calls[0] as any);const body=JSON.parse(init.body);
    expect(url).toBe(vertex?"https://synthetic.invalid/v1/projects/my-project/locations/global/publishers/google/models/selected-model:generateContent":
      "https://synthetic.invalid/v1beta/models/selected-model:generateContent");
    expect(init.headers).toEqual(vertex?{"content-type":"application/json",authorization:"Bearer SYNTHETIC_TOKEN"}:
      {"content-type":"application/json","x-goog-api-key":"SYNTHETIC_API_KEY"});
    expect(body.generationConfig).toEqual({temperature:0,maxOutputTokens:345,candidateCount:1,responseMimeType:"text/plain"});
    expect(body.contents).toEqual([{role:"user",parts:[{text:"Bonjour"}]}]);expect(body.systemInstruction.parts[0].text).toContain("French");expect(body.systemInstruction.parts[0].text).toContain("Japanese");
    expect(body.messages).toBeUndefined();expect(body.model).toBeUndefined();expect(init.redirect).toBe("error");
    expect(s.record.mock.calls.map(c=>(c as any)[0].state)).toEqual(["dispatching","confirmed"]);
    expect((s.record.mock.calls[1] as any)[0].metadata).toMatchObject({requestId:"google-response",reportedModel:"manual-model-v2",
      usage:{promptTokens:10,completionTokens:3,thoughtTokens:5,cachedPromptTokens:2,totalTokens:18}});
    expect(JSON.stringify(s.record.mock.calls)).not.toContain("SYNTHETIC_");
  });
  it("keeps active matching terminology and omits private/google-incompatible options",async()=>{
    const s=setup(),term={id:"t",sourceLanguage:"fr",targetLanguage:"ja",sourceText:"Bonjour",translatedText:"HELLO_TERM",status:"active",createdAt:"t",updatedAt:"t"} as const;
    await s.client().translate({...input,terminology:[term,{...term,id:"x",sourceLanguage:"en",translatedText:"WRONG"}]});
    const b=JSON.parse((s.fetchFn.mock.calls[0] as any)[1].body);expect(b.systemInstruction.parts[0].text).toContain("HELLO_TERM");expect(b.systemInstruction.parts[0].text).not.toContain("WRONG");
    expect(b).not.toHaveProperty("reasoning_effort");expect(b).not.toHaveProperty("enable_thinking");expect(b).not.toHaveProperty("tools");
  });
  it("accepts a configured API version and a models-prefixed model ID",async()=>{
    const s=setup();s.options.baseUrl="https://synthetic.invalid/v1/";s.options.model="models/chosen-model";
    await s.client().translate(input);expect((s.fetchFn.mock.calls[0] as any)[0]).toBe("https://synthetic.invalid/v1/models/chosen-model:generateContent");
  });
  it.each([{baseUrl:"http://private.invalid"},{baseUrl:"https://synthetic.invalid?key=secret"},{baseUrl:"https://synthetic.invalid/custom/chat/completions"},
    {model:"../escape"},{model:"."},{extraBody:{enable_thinking:false}},{apiKey:"BAD\nHEADER"}])("rejects unsafe or incompatible configuration %j",async patch=>{
    const s=setup();Object.assign(s.options,patch);await expect(s.client().translate(input)).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();expect(s.record).not.toHaveBeenCalled();
  });
  it.each(["projectId","location","accessToken"])("requires Vertex %s",async key=>{
    const google={protocol:"vertex" as const,projectId:"project",location:"global",accessToken:"SYNTHETIC_TOKEN"};delete (google as any)[key];
    const s=setup(google);await expect(s.client().translate(input)).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each([{}, {apiKey:"RAW_KEY_NOT_A_TOKEN"},{accessToken:"SYNTHETIC_TOKEN"},{accessToken:"SYNTHETIC_TOKEN",accessTokenExpiresAt:0}])("requires a resolved unexpired Vertex token %j",async value=>{
    const s=factory(true);s.opts.resolveCredentials=()=>value;await expect(s.create().translate(input)).rejects.toMatchObject({code:"public_translation_credentials_unavailable",outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each(["MAX_TOKENS","SAFETY","RECITATION","OTHER"])("does not accept finishReason %s or lose its usage",async finish=>{
    const s=setup(),b=payload();b.candidates[0].finishReason=finish;s.fetchFn.mockResolvedValue(new Response(JSON.stringify(b)));
    await expect(s.client().translate(input)).rejects.toMatchObject({outcome:"uncertain",metadata:{usage:{thoughtTokens:5,totalTokens:18}}});
    expect((s.record.mock.calls[1] as any)[0].state).toBe("uncertain");expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("rejects prompt block, no candidates, tools and multiple candidates",()=>{
    for(const patch of [{promptFeedback:{blockReason:"SAFETY"}},{candidates:[]},{candidates:[payload().candidates[0],payload().candidates[0]]},
      {candidates:[{finishReason:"STOP",content:{role:"model",parts:[{functionCall:{name:"do_not_execute"}}]}}]}])expect(()=>parseGoogleTranslation({...payload(),...patch},null)).toThrow();
  });
  it("never renders thought parts and rejects thought-only output",()=>{
    const b:any=payload();b.candidates[0].content.parts=[{thought:true,text:"PRIVATE_REASONING"},{text:"こんにちは"}];
    expect(parseGoogleTranslation(b,null).text).toBe("こんにちは");b.candidates[0].content.parts.pop();expect(()=>parseGoogleTranslation(b,null)).toThrow("empty");
  });
  it("does not invent missing usage or derive totals by adding overlapping token counts",()=>{
    const b:any=payload();delete b.usageMetadata;expect(parseGoogleTranslation(b,null).metadata).not.toHaveProperty("usage");
    b.usageMetadata={thoughtsTokenCount:4};expect(parseGoogleTranslation(b,null).metadata.usage).toEqual({thoughtTokens:4});
  });
  it.each([-1,0.5,"3",null])("rejects malformed token count %j",n=>{const b:any=payload();b.usageMetadata.thoughtsTokenCount=n;expect(()=>parseGoogleTranslation(b,null)).toThrow("invalid_usage");});
  it.each([401,429,503])("keeps HTTP %i outcome and does not retry or expose supplier text",async status=>{
    const s=setup();s.fetchFn.mockResolvedValue(new Response("SECRET_ERROR_TEXT",{status}));
    await expect(s.client().translate(input)).rejects.toMatchObject({outcome:status===503?"uncertain":"rejected"});expect(s.fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.record.mock.calls)).not.toContain("SECRET_ERROR_TEXT");
  });
  it("cancels stalled native response body and records uncertainty",async()=>{
    const s=setup(),controller=new AbortController();let cancel=false,entered!:()=>void;const started=new Promise<void>(r=>entered=r);
    s.fetchFn.mockImplementation(async()=>{entered();return new Response(new ReadableStream({cancel(){cancel=true;}}));});
    const pending=s.client().translate({...input,signal:controller.signal});const check=expect(pending).rejects.toMatchObject({outcome:"uncertain"});
    await started;await Promise.resolve();controller.abort();await check;expect(cancel).toBe(true);expect((s.record.mock.calls[1] as any)[0].state).toBe("uncertain");
  });
  it("health remains unqualified without requests",async()=>{const s=setup();expect(await s.client().healthCheck()).toBe(false);expect(s.fetchFn).not.toHaveBeenCalled();});
  it("rejects an unsafe quota project before dispatch",async()=>{
    const s=setup({protocol:"vertex",projectId:"project",location:"global",accessToken:"SYNTHETIC_TOKEN",quotaProjectId:"quota\nheader"});
    await expect(s.client().translate(input)).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("propagates caller cancellation into the credential resolver",async()=>{
    const s=factory(true),entered=new Promise<AbortSignal>(r=>{s.opts.resolveCredentials=async signal=>{r(signal!);return new Promise(()=>{});};});
    const controller=new AbortController(),pending=s.create().translate({...input,signal:controller.signal});const check=expect(pending).rejects.toMatchObject({outcome:"not_sent"});
    const signal=await entered;controller.abort();await check;expect(signal.aborted).toBe(true);expect(s.fetchFn).not.toHaveBeenCalled();
  });
});
