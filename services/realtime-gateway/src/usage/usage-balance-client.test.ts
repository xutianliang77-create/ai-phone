import {afterEach,describe,expect,it,vi} from "vitest";
import type {RealtimeEnv} from "../config/env.js";
import {createUsageBalanceClient} from "./usage-balance-client.js";

afterEach(()=>vi.restoreAllMocks());
function client(){
  return createUsageBalanceClient({apiBaseUrl:"https://synthetic-api.test",
    internalApiSecret:"synthetic-internal-secret",sessionSyncTimeoutMs:500} as RealtimeEnv);
}
describe("public account allowance client",()=>{
  it("requests a session-scoped allowance and rejects invalid accounting replies",async()=>{
    const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(
      JSON.stringify({status:"held",authorizedSeconds:60,remainingSeconds:90,availableSeconds:0}),{status:200}));
    expect(await client().reserveAllowance!("session-1",60)).toEqual({
      authorizedSeconds:60,remainingSeconds:90,availableSeconds:0,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe("https://synthetic-api.test/internal/usage/allowance/session-1");
    expect(fetch.mock.calls[0]![1]).toMatchObject({method:"POST",
      headers:{authorization:"Bearer synthetic-internal-secret"}});
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({targetSeconds:60});
    fetch.mockResolvedValueOnce(new Response('{"status":"held","authorizedSeconds":1e309,"remainingSeconds":90,"availableSeconds":0}',{status:200}));
    expect(await client().reserveAllowance!("session-1",60)).toBeNull();
    fetch.mockResolvedValueOnce(new Response('{"status":"held","authorizedSeconds":60,"remainingSeconds":0.5,"availableSeconds":0}',{status:200}));
    expect(await client().reserveAllowance!("session-1",60)).toBeNull();
  });
  it("returns no allowance on API errors instead of guessing quota",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response("unavailable",{status:503}));
    expect(await client().reserveAllowance!("session-1",60)).toBeNull();
    expect(await client().reserveAllowance!("",60)).toBeNull();
  });
});
