import {afterEach,describe,it,expect,vi} from "vitest";
import {LmStudioRealtimeProvider} from "./lmstudio-realtime-provider.js";
import {LmStudioClient} from "./lmstudio-client.js";
import {RealtimeTranscriptRefiner} from "./lmstudio-asr-refinement.js";
import type {TranslationClient} from "./lmstudio-realtime-provider-options.js";
import type {AsrProvider} from "../../asr/asr-provider.js";
const session={sessionId:"cancel-test",sourceLanguage:"en" as const,targetLanguage:"zh" as const,voiceOutput:false};
const segment={sessionId:session.sessionId,segmentId:"seg",text:"Good morning everyone",language:"en" as const,isFinal:true,finalizeImmediately:true};
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function provider(client:TranslationClient,asrProvider?:AsrProvider){return new LmStudioRealtimeProvider({baseUrl:"https://synthetic.test/v1",model:"test-model",timeoutMs:1000,translationClient:client,asrProvider});}
afterEach(()=>vi.restoreAllMocks());
describe("original realtime provider translation cancellation",()=>{
  it("propagates close to the actual public compatible HTTP client and emits no late failure",async()=>{
    const entered=deferred<AbortSignal>();let cancelled=false;
    const fetchFn=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      entered.resolve(init!.signal as AbortSignal);
      return new Response(new ReadableStream({cancel(){cancelled=true;}}));
    });
    const client=new LmStudioClient({baseUrl:"https://synthetic.test/v1",model:"test-model",apiKey:"synthetic-key",timeoutMs:1000,transportProfile:"public_compatible",fetchFn});
    const p=provider(client);await p.createSession(session);const output=p.sendText(segment);
    expect((await output.next()).value.type).toBe("transcript.final");const pending=output.next();
    const signal=await entered.promise;await Promise.resolve();await p.closeSession(session.sessionId);
    expect(signal.aborted).toBe(true);expect((await pending).done).toBe(true);expect(fetchFn).toHaveBeenCalledTimes(1);
    // Body may be cancelled by the fetch AbortSignal or by its reader cleanup.
    await Promise.resolve();expect(cancelled).toBe(true);
  });
  it.each(["resolve","reject"] as const)("discards a late %s from a non-cooperative injected client",async how=>{
    const wait=deferred<string>(),entered=deferred<void>();const translate=vi.fn(async()=>{entered.resolve();return wait.promise;});
    const p=provider({translate,healthCheck:async()=>true});await p.createSession(session);
    const output=p.sendText(segment);await output.next();const pending=output.next();await entered.promise;await p.closeSession(session.sessionId);
    expect((await pending).done).toBe(true);
    if(how==="resolve")wait.resolve("old result");else wait.reject(Error("old failure"));
    await Promise.resolve();expect((await output.next()).done).toBe(true);
  });
  it("does not start a model request when closed between transcript and translation",async()=>{
    const translate=vi.fn(async()=>"你好");const p=provider({translate,healthCheck:async()=>true});await p.createSession(session);
    const output=p.sendText(segment);expect((await output.next()).value.type).toBe("transcript.final");
    await p.closeSession(session.sessionId);expect((await output.next()).done).toBe(true);expect(translate).not.toHaveBeenCalled();
  });
  it("reusing the same session input object cancels old work but allows the new session",async()=>{
    const wait=deferred<string>(),entered=deferred<void>();let count=0;
    const p=provider({translate:async()=>{if(++count===1){entered.resolve();return wait.promise;}return "新会话译文";},healthCheck:async()=>true});
    await p.createSession(session);const old=p.sendText(segment);await old.next();const pending=old.next();await entered.promise;
    await p.createSession(session);expect((await pending).done).toBe(true);wait.resolve("old result");
    const output=[];for await(const e of p.sendText({...segment,segmentId:"new"}))output.push(e);
    expect(output.filter(e=>e.type==="translation.final")).toEqual([expect.objectContaining({text:"新会话译文",segmentId:"new"})]);
    await p.closeSession(session.sessionId);
  });
  it("does not put an old yielded translation into a recreated session's context",async()=>{
    const remember=vi.spyOn(RealtimeTranscriptRefiner.prototype,"remember");
    const p=provider({translate:async()=>"你好",healthCheck:async()=>true});await p.createSession(session);
    const output=p.sendText(segment);await output.next();expect((await output.next()).value.type).toBe("translation.final");
    await p.closeSession(session.sessionId);await p.createSession(session);await output.next();
    expect(remember).not.toHaveBeenCalled();await p.closeSession(session.sessionId);
  });
  it("drops refinement completed after close before it emits text or starts MT",async()=>{
    const wait=deferred<any>(),entered=deferred<void>();
    vi.spyOn(RealtimeTranscriptRefiner.prototype,"refine").mockImplementationOnce(()=>{entered.resolve();return wait.promise;});
    const translate=vi.fn(async()=>"你好");const p=provider({translate,healthCheck:async()=>true});await p.createSession(session);
    const pending=p.sendText(segment).next();await entered.promise;await p.closeSession(session.sessionId);
    wait.resolve({text:"late",rawText:"late",refinement:{}});expect((await pending).done).toBe(true);expect(translate).not.toHaveBeenCalled();
  });
  it("drops late ASR results without processing them in a replacement session",async()=>{
    const wait=deferred<any>(),entered=deferred<void>();const translate=vi.fn(async()=>"你好");
    const asr={createSession:async()=>{},transcribe:async()=>{entered.resolve();return wait.promise;},flush:async()=>null,closeSession:async()=>{},healthCheck:async()=>true} as AsrProvider;
    const p=provider({translate,healthCheck:async()=>true},asr);await p.createSession(session);
    const pending=p.sendAudio({type:"audio.frame",sessionId:session.sessionId,sequence:1,timestampMs:0,format:"pcm16",sampleRate:16000,data:"AAA="}).next();
    await entered.promise;await p.closeSession(session.sessionId);await p.createSession(session);
    wait.resolve({segmentId:"late",language:"en",text:"late old text",isFinal:true});
    expect((await pending).done).toBe(true);expect(translate).not.toHaveBeenCalled();await p.closeSession(session.sessionId);
  });
  it("does not leave a usable session after ASR creation fails",async()=>{
    const translate=vi.fn(async()=>"你好");const asr={createSession:async()=>{throw Error("creation failed");},closeSession:async()=>{}} as AsrProvider;
    const p=provider({translate,healthCheck:async()=>true},asr);await expect(p.createSession(session)).rejects.toThrow("creation failed");
    const output=[];for await(const e of p.sendText(segment))output.push(e);
    expect(output).toEqual([expect.objectContaining({type:"error"})]);expect(translate).not.toHaveBeenCalled();
  });
  it("does not emit the remaining partials from an old ASR batch after close",async()=>{
    const asr={createSession:async()=>{},transcribe:async()=>[
      {segmentId:"a",text:"first partial",language:"en",isFinal:false},
      {segmentId:"b",text:"second partial",language:"en",isFinal:false}],flush:async()=>null,closeSession:async()=>{},healthCheck:async()=>true} as AsrProvider;
    const p=provider({translate:async()=>"unused",healthCheck:async()=>true},asr);await p.createSession(session);
    const output=p.sendAudio({type:"audio.frame",sessionId:session.sessionId,sequence:1,timestampMs:0,format:"pcm16",sampleRate:16000,data:"AAA="});
    expect((await output.next()).value.type).toBe("transcript.partial");await p.closeSession(session.sessionId);
    expect((await output.next()).done).toBe(true);
  });
});
