import {afterEach,describe,expect,it,vi} from "vitest";
import {RealtimeGatewayShutdown} from "./realtime-gateway-shutdown.js";

function deferred() {
  let resolve!:()=>void;
  return {promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};
}
function fixture() {
  const clients=new Set<{readyState:number;close:ReturnType<typeof vi.fn>;terminate:ReturnType<typeof vi.fn>}>();
  const stopAccepting=vi.fn(),closeTransport=vi.fn(async()=>{}),onError=vi.fn();
  return {clients,stopAccepting,closeTransport,onError,shutdown:new RealtimeGatewayShutdown({
    clients:()=>clients,stopAccepting,closeTransport,onError,timeoutMs:100,
  })};
}
const client=()=>({readyState:1,close:vi.fn(),terminate:vi.fn()});
afterEach(()=>vi.useRealTimers());

describe("bounded graceful Gateway shutdown",()=>{
  it("keeps transport alive until original finalization/drain acknowledges once",async()=>{
    const f=fixture(),ws=client(),ack=deferred();f.clients.add(ws);
    const stop=vi.fn(()=>ack.promise),force=vi.fn(async()=>{});
    f.shutdown.add(ws,{owns:()=>true,stop,force});
    const first=f.shutdown.stop();expect(f.shutdown.stop()).toBe(first);
    await Promise.resolve();expect(stop).toHaveBeenCalledTimes(1);
    expect(f.stopAccepting).toHaveBeenCalledOnce();expect(f.closeTransport).not.toHaveBeenCalled();
    ack.resolve();expect(await first).toBe(true);
    expect(f.closeTransport).toHaveBeenCalledOnce();expect(force).not.toHaveBeenCalled();
  });
  it("tracks an in-flight initialization and drains its late attached session",async()=>{
    const f=fixture(),ws=client(),init=deferred(),ack=deferred();f.clients.add(ws);
    const stop=vi.fn(()=>ack.promise);
    f.shutdown.track(ws,init.promise.then(()=>f.shutdown.add(ws,{owns:()=>true,stop,force:async()=>{}})));
    const stopping=f.shutdown.stop();expect(ws.close).toHaveBeenCalledWith(1012,"server_shutdown");
    init.resolve();await Promise.resolve();await Promise.resolve();
    expect(f.closeTransport).not.toHaveBeenCalled();ack.resolve();
    expect(await stopping).toBe(true);expect(stop).toHaveBeenCalledOnce();
  });
  it("forces a timed-out provider/socket closed without reporting confirmed stop",async()=>{
    vi.useFakeTimers();const f=fixture(),ws=client();f.clients.add(ws);
    const force=vi.fn(async()=>{});
    f.shutdown.add(ws,{owns:()=>true,stop:()=>new Promise(()=>{}),force});
    const stopping=f.shutdown.stop();await vi.advanceTimersByTimeAsync(100);
    expect(await stopping).toBe(false);expect(force).toHaveBeenCalledOnce();
    expect(ws.terminate).toHaveBeenCalledOnce();expect(f.closeTransport).toHaveBeenCalledOnce();
  });
  it("never reports a failed finalization as success",async()=>{
    const f=fixture(),ws=client(),error=Error("durable stop failed");f.clients.add(ws);
    const force=vi.fn(async()=>{});
    f.shutdown.add(ws,{owns:()=>true,stop:async()=>{throw error;},force});
    expect(await f.shutdown.stop()).toBe(false);expect(f.onError).toHaveBeenCalledWith(error);
    expect(force).toHaveBeenCalledOnce();expect(ws.terminate).toHaveBeenCalledOnce();
  });
  it("prunes a stale generation instead of stopping its replacement provider",async()=>{
    const f=fixture(),old=client(),current=client(),staleStop=vi.fn(async()=>{});
    const stop=vi.fn(async()=>{});f.clients.add(current);
    f.shutdown.add(old,{owns:()=>false,stop:staleStop,force:async()=>{}});
    f.shutdown.add(current,{owns:()=>true,stop,force:async()=>{}});
    expect(await f.shutdown.stop()).toBe(true);
    expect(staleStop).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledOnce();
  });
});
