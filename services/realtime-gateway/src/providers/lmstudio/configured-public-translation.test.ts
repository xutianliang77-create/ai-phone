import {afterEach,describe,it,expect,vi} from "vitest";
import {ProviderRouter} from "../provider-router.js";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";
import {LmStudioClient} from "./lmstudio-client.js";
import type {ConfiguredPublicTranslationOptions} from "./configured-public-translation.js";
const input={text:"Bonjour",sourceLanguage:"fr",targetLanguage:"ja",attemptContext:{segmentId:"segment",revision:1}};
const response=()=>new Response(JSON.stringify({model:"chosen-model",choices:[{finish_reason:"stop",message:{content:"こんにちは"}}],
  usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}),{headers:{"x-request-id":"synthetic-request"}});
function setup(vendor="qwen",protocol="qwen_chat"){
  const executionPlan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const record=vi.fn(async()=>{}),fetchFn=vi.fn(async()=>response()),resolveCredentials=vi.fn(async()=>({apiKey:"SYNTHETIC_ONLY"}));
  const options:ConfiguredPublicTranslationOptions={deploymentId:"public-test",snapshot:{deploymentId:"public-test",configurationRevision:1,configurationHash:"a".repeat(64),
    modelPolicyRevision:"policy",executionPlan,components:{translation:{enabled:true,vendor,protocol,authKind:"api_key",endpoint:"https://synthetic.invalid/compatible/v1",modelId:"chosen-model",timeoutMs:1000,maxTokens:700}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan,
      languagePolicy:{source:"fr",target:"ja",autoReverse:false,revision:1},syncPermission:{allowed:false}},
    attemptRecorder:{sessionId:"session",leaseId:"lease",providerId:vendor,record},resolveCredentials,fetchFn};
  return {options,record,fetchFn,resolveCredentials,create:()=>new ProviderRouter().createConfiguredTranslationClient(options)};
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe("original router configured compatible MT component",()=>{
  it.each([["qwen","qwen_chat"],["tencent","tencent_hunyuan_chat"],["openai","openai_chat"]])("maps %s/%s without a fixed model, preserving language and attempt metadata",async(v,p)=>{
    const s=setup(v,p);const client=s.create();expect(await client.healthCheck()).toBe(false);expect(s.fetchFn).not.toHaveBeenCalled();
    expect(await client.translate(input)).toBe("こんにちは");const [url,init]=(s.fetchFn.mock.calls[0] as unknown as [string,RequestInit]);
    expect(url).toBe("https://synthetic.invalid/compatible/v1/chat/completions");
    const body=JSON.parse(String(init.body));expect(body).toMatchObject({model:"chosen-model",max_tokens:700,stream:false});
    expect(body.messages[0].content).toContain("French");expect(body.messages[0].content).toContain("Japanese");
    expect(body.enable_thinking).toBe(v==="qwen"?false:undefined);expect(body).not.toHaveProperty("reasoning_effort");
    expect(s.record.mock.calls.map(c=>(c as any)[0].state)).toEqual(["dispatching","confirmed"]);
    expect((s.record.mock.calls[1] as any)[0]).toMatchObject({providerId:v,modelId:"chosen-model",metadata:{usage:{totalTokens:7}}});
    expect(JSON.stringify(s.record.mock.calls)).not.toContain("SYNTHETIC_ONLY");
  });
  it.each([["https://synthetic.invalid","https://synthetic.invalid/v1/chat/completions"],
    ["https://synthetic.invalid/v1/","https://synthetic.invalid/v1/chat/completions"],
    ["https://synthetic.invalid/api/v3","https://synthetic.invalid/api/v3/chat/completions"],
    ["https://synthetic.invalid/custom/chat/completions/","https://synthetic.invalid/custom/chat/completions"]])("preserves manual API prefix %s",async(endpoint,expected)=>{
    const s=setup();s.options.snapshot.components.translation!.endpoint=endpoint;await s.create().translate(input);
    expect((s.fetchFn.mock.calls[0] as any)[0]).toBe(expected);
  });
  it.each(["google_unknown","google_chat_unsupported"])("does not pretend %s is a compatible adapter",protocol=>{
    const s=setup("google",protocol);expect(()=>s.create()).toThrow("protocol_not_implemented");expect(s.resolveCredentials).not.toHaveBeenCalled();expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each(["deployment","policy","plan","vendor","protocol","recorder"])("rejects mismatched %s before reading secrets",field=>{
    const s=setup();if(field==="deployment")s.options.deploymentId="other";
    if(field==="policy")s.options.authorization.modelPolicyRevision="other";
    if(field==="plan")s.options.authorization={...s.options.authorization,executionPlan:{...s.options.authorization.executionPlan,tts:{execution:"public",scopeKey:"other",reason:"online_selected"}}};
    if(field==="vendor")s.options.snapshot.components.translation!.vendor="constructor";
    if(field==="protocol")s.options.snapshot.components.translation!.protocol="openai_chat";
    if(field==="recorder")s.options.attemptRecorder.providerId="other";
    expect(()=>s.create()).toThrow();expect(s.resolveCredentials).not.toHaveBeenCalled();expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("copies bound parameters and identities rather than following mutable factory inputs",async()=>{
    const s=setup(),client=s.create();s.options.snapshot.components.translation!.modelId="changed";s.options.attemptRecorder.sessionId="other";
    await client.translate(input);expect((s.record.mock.calls[0] as any)[0]).toMatchObject({sessionId:"session",modelId:"chosen-model"});
  });
  it("resolves exact credentials on every request and sanitizes failures without model calls",async()=>{
    const s=setup(),client=s.create();await client.translate(input);
    s.resolveCredentials.mockRejectedValueOnce(Error("ROTATED_KEY_PRIVATE_TEXT"));
    await expect(client.translate(input)).rejects.toMatchObject({code:"public_translation_credentials_unavailable",outcome:"not_sent"});
    expect(s.fetchFn).toHaveBeenCalledTimes(1);expect(s.resolveCredentials).toHaveBeenCalledTimes(2);
  });
  it.each(["","bad\nheader"," bad "])("rejects unusable credentials %j",async apiKey=>{
    const s=setup();s.resolveCredentials.mockResolvedValue({apiKey});await expect(s.create().translate(input)).rejects.toMatchObject({outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("waits for durable dispatch intent and does not call a supplier after admission refusal",async()=>{
    const s=setup();s.record.mockRejectedValue(Error("revoked"));await expect(s.create().translate(input)).rejects.toMatchObject({code:"public_attempt_record_failed",outcome:"not_sent"});expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("bounds stalled credential lookup before dispatch",async()=>{
    vi.useFakeTimers();const s=setup();s.resolveCredentials.mockImplementation(()=>new Promise(()=>{}));const pending=s.create().translate(input);
    const check=expect(pending).rejects.toMatchObject({code:"public_translation_timeout",outcome:"not_sent"});await vi.advanceTimersByTimeAsync(1001);await check;expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("cancels lookup via original Provider close without late translation",async()=>{
    const s=setup();let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
    s.resolveCredentials.mockImplementation(async()=>{entered();return new Promise(()=>{});});
    const provider=new LmStudioRealtimeProvider({baseUrl:"https://unused.invalid",model:"chosen-model",timeoutMs:1000,translationClient:s.create()});
    await provider.createSession({sessionId:"session",sourceLanguage:"fr",targetLanguage:"ja",voiceOutput:false});
    const events=provider.sendText({sessionId:"session",segmentId:"s",text:"Bonjour tout le monde",language:"fr",isFinal:true,finalizeImmediately:true});
    expect((await events.next()).value.type).toBe("transcript.final");const pending=events.next();await started;await provider.closeSession("session");
    expect((await pending).done).toBe(true);expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("does not retry uncertain responses or rewrite them as success",async()=>{
    const s=setup();s.fetchFn.mockResolvedValue(new Response("SYNTHETIC_ERROR",{status:503}));
    await expect(s.create().translate(input)).rejects.toMatchObject({outcome:"uncertain"});expect(s.fetchFn).toHaveBeenCalledTimes(1);
    expect((s.record.mock.calls[1] as any)[0].state).toBe("uncertain");
  });
  it("preserves the existing private URL semantics",async()=>{
    const fetchFn=vi.fn(async()=>response());const client=new LmStudioClient({baseUrl:"http://private.invalid/api",model:"old",timeoutMs:1000,fetchFn});
    await client.translate(input);expect((fetchFn.mock.calls[0] as any)[0]).toBe("http://private.invalid/api/v1/chat/completions");
  });
  it("does not open public Router admission",()=>{expect(()=>new ProviderRouter().selectProvider({publicDeploymentId:"public-test"} as any)).toThrow("public_processing_not_ready");});
  it("rejects another language pair before resolving credentials",async()=>{
    const s=setup();await expect(s.create().translate({...input,targetLanguage:"en"})).rejects.toMatchObject({code:"public_translation_language_scope_mismatch",outcome:"not_sent"});
    expect(s.resolveCredentials).not.toHaveBeenCalled();expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it("follows the authorized auto-reverse pair and passes the actual direction to the original prompt",async()=>{
    const s=setup();s.options.authorization.languagePolicy={source:"auto",target:"ja",autoReverse:true,pair:["fr","ja"],revision:2};
    await s.create().translate({...input,sourceLanguage:"ja",targetLanguage:"fr"});
    const b=JSON.parse(String((s.fetchFn.mock.calls[0] as any)[1].body));expect(b.messages[0].content).toContain("Source language: Japanese");expect(b.messages[0].content).toContain("into French");
  });
});
