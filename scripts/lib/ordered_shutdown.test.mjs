import {EventEmitter} from "node:events";
import {afterEach,describe,expect,it,vi} from "vitest";
import {stopApplicationChildren} from "../../infra/ai-phone-server/ordered-shutdown.mjs";

class Child extends EventEmitter {
  exitCode=null;signalCode=null;signals=[];
  kill(signal){this.signals.push(signal);return true;}
  finish(code=0){this.exitCode=code;this.emit("exit",code,null);}
}
afterEach(()=>vi.useRealTimers());
describe("single-container API-last shutdown",()=>{
  it("keeps API running while the original Gateway/Worker stops persist",async()=>{
    const api=new Child(),gateway=new Child(),worker=new Child();
    const stopping=stopApplicationChildren(new Map([["api",api],["realtime",gateway],["translation-agent",worker]]));
    expect(gateway.signals).toEqual(["SIGTERM"]);expect(worker.signals).toEqual(["SIGTERM"]);
    expect(api.signals).toEqual([]);gateway.finish();await Promise.resolve();expect(api.signals).toEqual([]);
    worker.finish();await new Promise(resolve=>setImmediate(resolve));
    expect(api.signals).toEqual(["SIGTERM"]);api.finish();
    expect(await stopping).toEqual({forced:false,failed:false});
  });
  it("bounds dependent cleanup and reports the forced kill before stopping API",async()=>{
    vi.useFakeTimers();const api=new Child(),gateway=new Child();
    const stopping=stopApplicationChildren(new Map([["api",api],["realtime",gateway]]),{dependentGraceMs:100,apiGraceMs:50});
    await vi.advanceTimersByTimeAsync(100);
    expect(gateway.signals).toEqual(["SIGTERM","SIGKILL"]);expect(api.signals).toEqual(["SIGTERM"]);
    api.finish();expect(await stopping).toEqual({forced:true,failed:false});
  });
  it("preserves an abnormal dependent exit instead of claiming graceful completion",async()=>{
    const api=new Child(),gateway=new Child();
    const stopping=stopApplicationChildren(new Map([["api",api],["realtime",gateway]]));
    gateway.finish(1);await new Promise(resolve=>setImmediate(resolve));api.finish();
    expect(await stopping).toEqual({forced:false,failed:true});
  });
});
