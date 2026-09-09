import {afterEach,describe,it,expect,vi} from "vitest";
import {createServer} from "node:http";
import {once} from "node:events";
import {HttpAsrClient} from "./http-asr-client.js";
import {HttpAsrProvider} from "./http-asr-provider.js";
const request={sessionId:"asr-cancel",sequence:1,timestampMs:0,format:"pcm16" as const,sampleRate:16000,data:"AAA=",sourceLanguage:"fr" as const,targetLanguage:"ja" as const};
const session={sessionId:request.sessionId,sourceLanguage:"fr" as const,targetLanguage:"ja" as const,asrHotwords:["bonjour"]};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("original HTTP ASR request lifecycle",()=>{
  it.each(["transcribe","flush","boundary","diagnostics"] as const)("keeps the deadline through %s body decoding",async action=>{
    vi.useFakeTimers();let signal:AbortSignal|undefined;
    const fetchFn=vi.fn(async(_url:unknown,init?:RequestInit)=>{signal=init?.signal as AbortSignal;return {ok:true,status:200,json:()=>new Promise(()=>{})} as Response;});
    const client=new HttpAsrClient({endpoint:"http://synthetic.test/asr/transcribe",timeoutMs:25,fetchFn});
    const call=action==="transcribe"?client.transcribe(request):action==="flush"?client.flush(request):
      action==="boundary"?client.commitBoundary({...request,boundaryMs:10}):client.diagnostics(request.sessionId);
    const check=expect(call).rejects.toMatchObject({name:"AbortError"});
    await vi.advanceTimersByTimeAsync(26);await check;expect(signal?.aborted).toBe(true);expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("does not send an already-cancelled request or serialize AbortSignal into model inputs",async()=>{
    const fetchFn=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(JSON.parse(String(init?.body))).toEqual(request);return new Response('{"text":"bonjour","language":"fr"}');});
    const client=new HttpAsrClient({endpoint:"http://synthetic.test/asr/transcribe",timeoutMs:100,fetchFn});
    const aborted=new AbortController();aborted.abort();await expect(client.transcribe(request,aborted.signal)).rejects.toMatchObject({name:"AbortError"});
    expect(fetchFn).not.toHaveBeenCalled();expect((await client.transcribe(request,new AbortController().signal))?.language).toBe("fr");
  });
  it("close cancels transcribe, flush and boundary but leaves cleanup with its own live signal",async()=>{
    const requests:Array<{signal:AbortSignal;method:string;body:any}>=[];
    const fetchFn=vi.fn((_url:unknown,init?:RequestInit)=>{
      const signal=init!.signal as AbortSignal;requests.push({signal,method:String(init?.method),body:init?.body?JSON.parse(String(init.body)):undefined});
      if(init?.method==="DELETE")return Promise.resolve(new Response("{}"));
      return new Promise<Response>((_r,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));
    });
    const provider=new HttpAsrProvider({endpoint:"http://synthetic.test/asr/transcribe",timeoutMs:1000,fetchFn});await provider.createSession(session);
    const pending=[provider.transcribe(request),provider.flush(request.sessionId),provider.commitBoundary({sessionId:request.sessionId,boundaryMs:100})]
      .map(p=>p.then(()=>"unexpected",e=>e.name));
    await provider.closeSession(request.sessionId);expect(await Promise.all(pending)).toEqual(["AbortError","AbortError","AbortError"]);
    expect(requests.slice(0,3).every(r=>r.signal.aborted&&r.body.sourceLanguage==="fr"&&r.body.targetLanguage==="ja")).toBe(true);
    expect(requests[3].method).toBe("DELETE");expect(requests[3].signal.aborted).toBe(false);
  });
  it("same-ID replacement aborts old reads and snapshots the new language configuration",async()=>{
    let n=0;
    const fetchFn=vi.fn((_url:unknown,init?:RequestInit)=>{
      if(++n===1)return new Promise<Response>((_r,j)=>(init!.signal as AbortSignal).addEventListener("abort",()=>j(new DOMException("Aborted","AbortError")),{once:true}));
      if(init?.method==="DELETE")return Promise.resolve(new Response("{}"));
      expect(JSON.parse(String(init?.body)).sourceLanguage).toBe("fr");return Promise.resolve(new Response('{"text":"bonjour","language":"fr"}'));
    });
    const p=new HttpAsrProvider({endpoint:"http://synthetic.test/asr/transcribe",timeoutMs:1000,fetchFn});await p.createSession(session);
    const old=p.transcribe(request).catch(e=>e.name);const replacement={...session};await p.createSession(replacement);
    (replacement as {sourceLanguage:string}).sourceLanguage="en";
    expect(await old).toBe("AbortError");expect((await p.transcribe(request))?.text).toBe("bonjour");await p.closeSession(request.sessionId);
  });
  it("aborts a real loopback response that stalls after HTTP headers",async()=>{
    let closed!:()=>void;const disconnected=new Promise<void>(r=>{closed=r;});
    let headersSent=false;
    const server=createServer((_req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.write('{"text":');headersSent=true;res.on("close",closed);});
    server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("missing address");
    try{
      const client=new HttpAsrClient({endpoint:`http://127.0.0.1:${address.port}/asr/transcribe`,timeoutMs:1000});
      await expect(client.transcribe(request)).rejects.toMatchObject({name:"AbortError"});
      expect(headersSent).toBe(true);
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([disconnected,new Promise<never>((_r,j)=>{timer=setTimeout(()=>j(Error("socket did not close")),2000);})]);}
      finally{if(timer)clearTimeout(timer);}
    }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  });
});
