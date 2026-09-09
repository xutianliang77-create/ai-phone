import {afterEach,describe,it,expect,vi} from "vitest";
import {LmStudioClient,type LmStudioClientOptions} from "./lmstudio-client.js";
import {PublicTranslationError} from "./lmstudio-public-protocol.js";
const input={text:"bonjour",sourceLanguage:"fr",targetLanguage:"ja"};
const payload=(extra={})=>({id:"completion-1",model:"configured-model",choices:[{finish_reason:"stop",message:{content:"こんにちは"}}],...extra});
const response=(data=payload(),status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","x-request-id":"request-1"}});
function setup(overrides:Partial<LmStudioClientOptions>={}){
  const fetchFn=vi.fn(async()=>response());
  const client=new LmStudioClient({baseUrl:"https://synthetic.test/v1",model:"configured-model",apiKey:"synthetic-key",
    timeoutMs:1000,transportProfile:"public_compatible",fetchFn,...overrides});return {client,fetchFn};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("original compatible MT client public protocol profile",()=>{
  it("uses exact source/target and active glossary pair, preserving the old prompt rules",async()=>{
    let body:Record<string,any>={},options:RequestInit={};
    const {client}=setup({fetchFn:async(_url,init)=>{body=JSON.parse(String(init?.body));options=init!;return response(payload({usage:{prompt_tokens:11,completion_tokens:4,total_tokens:15}}));}});
    const term={id:"term",sourceText:"bonjour",translatedText:"こんにちは",sourceLanguage:"fr",targetLanguage:"ja",status:"active",createdAt:"t",updatedAt:"t"} as const;
    const result=await client.translateWithMetadata({...input,terminology:[term,{...term,sourceLanguage:"en",sourceText:"WRONG_SOURCE"}]});
    expect(body.model).toBe("configured-model");expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain("Source language: French");expect(body.messages[0].content).toContain("Japanese");
    expect(body.messages[0].content).toContain("bonjour => こんにちは");expect(body.messages[0].content).not.toContain("WRONG_SOURCE");
    expect(options.redirect).toBe("error");expect(result).toEqual({text:"こんにちは",metadata:{requestId:"request-1",reportedModel:"configured-model",usage:{promptTokens:11,completionTokens:4,totalTokens:15}}});
  });
  it.each([{baseUrl:"http://private.test/v1"},{baseUrl:"https://user:password@synthetic.test/v1"},{baseUrl:"https://synthetic.test/v1?key=secret"},
    {apiKey:""},{extraBody:{model:"override"}},{extraBody:{stream:true}},{extraBody:{max_tokens:999}},{extraBody:{enable_thinking:true}}])(
    "rejects unsafe or reserved configuration before sending %j",async options=>{
      const {client,fetchFn}=setup(options);await expect(client.translate(input)).rejects.toMatchObject({outcome:"not_sent"});expect(fetchFn).not.toHaveBeenCalled();
    });
  it.each([{sourceLanguage:"auto"},{targetLanguage:"unsupported"},{targetLanguage:"fr"},{text:" "}])("rejects unresolved language or empty input %j",async patch=>{
    const {client,fetchFn}=setup();await expect(client.translate({...input,...patch})).rejects.toMatchObject({code:"public_translation_invalid_input",outcome:"not_sent"});expect(fetchFn).not.toHaveBeenCalled();
  });
  it("returns unknown usage as absent, never guessed zero",async()=>{
    const {client}=setup();const result=await client.translateWithMetadata(input);expect(result.metadata).not.toHaveProperty("usage");
  });
  it.each([429,401,503])("does not retry HTTP %i or expose provider error text",async status=>{
    const fetchFn=vi.fn(async()=>response({error:{message:"private text and secret key"}} as never,status));const {client}=setup({fetchFn});
    let failure:unknown;try{await client.translate(input);}catch(e){failure=e;}
    expect(failure).toBeInstanceOf(PublicTranslationError);expect(failure).toMatchObject({status,outcome:status===503?"uncertain":"rejected",metadata:{requestId:"request-1"}});
    expect(JSON.stringify(failure)).not.toContain("private text");expect(String(failure)).not.toContain("secret key");expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("does not convert reasoning-only or truncated output into translation",async()=>{
    for(const data of [payload({choices:[{finish_reason:"stop",message:{content:"",reasoning_content:"The translation is hello"}}]}),
      payload({choices:[{finish_reason:"length",message:{content:"partial"}}]})]){
      const {client}=setup({fetchFn:async()=>response(data)});await expect(client.translate(input)).rejects.toMatchObject({outcome:"uncertain"});
    }
  });
  it("preserves available usage on incomplete responses without claiming success",async()=>{
    const {client}=setup({fetchFn:async()=>response(payload({usage:{prompt_tokens:7},choices:[{finish_reason:"length",message:{content:"partial"}}]}))});
    await expect(client.translate(input)).rejects.toMatchObject({code:"public_translation_incomplete",metadata:{requestId:"request-1",usage:{promptTokens:7}}});
  });
  it("rejects malformed usage and oversized response bodies",async()=>{
    const invalid=setup({fetchFn:async()=>response(payload({usage:{prompt_tokens:-1}}))});await expect(invalid.client.translate(input)).rejects.toMatchObject({code:"public_translation_invalid_usage"});
    const large=setup({fetchFn:async()=>new Response("x".repeat(262145))});await expect(large.client.translate(input)).rejects.toMatchObject({code:"public_translation_response_too_large"});
  });
  it("cancels before dispatch without an attempt",async()=>{
    const controller=new AbortController();controller.abort();const {client,fetchFn}=setup();
    await expect(client.translate({...input,signal:controller.signal})).rejects.toMatchObject({code:"public_translation_cancelled",outcome:"not_sent"});expect(fetchFn).not.toHaveBeenCalled();
  });
  it("propagates cancellation through a stalled response body and releases its reader",async()=>{
    let ready!:()=>void;const reading=new Promise<void>(r=>{ready=r;});let cancelled=false,pulls=0;
    const fetchFn=vi.fn(async()=>new Response(new ReadableStream({pull(controller){
      if(++pulls===1)controller.enqueue(new TextEncoder().encode('{"choices":['));else ready();
    },cancel(){cancelled=true;}})));
    const {client}=setup({fetchFn});const controller=new AbortController();
    const result=client.translate({...input,signal:controller.signal});const check=expect(result).rejects.toMatchObject({code:"public_translation_cancelled",outcome:"uncertain"});
    await reading;controller.abort();await check;expect(cancelled).toBe(true);expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("times out a hung fetch without retrying or exposing transport details",async()=>{
    vi.useFakeTimers();const fetchFn=vi.fn(()=>new Promise<Response>(()=>{}));const {client}=setup({timeoutMs:25,fetchFn});
    const check=expect(client.translate(input)).rejects.toMatchObject({code:"public_translation_timeout",outcome:"uncertain"});
    await vi.advanceTimersByTimeAsync(26);await check;expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("redacts arbitrary network errors and never treats a catalog as qualification",async()=>{
    const fetchFn=vi.fn(async()=>{throw Error("sensitive URL token text");});const {client}=setup({fetchFn});
    await expect(client.translate(input)).rejects.toThrow("public_translation_transport_or_payload_error");
    expect(await client.healthCheck()).toBe(false);expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
