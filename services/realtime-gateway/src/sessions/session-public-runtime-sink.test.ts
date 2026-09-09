import {it,expect,vi,afterEach} from "vitest";
import {createSessionEventSink} from "./session-event-sink.js";
import type {RealtimeEnv} from "../config/env.js";
import type {PublicRuntimeObservation} from "@translation/contracts";
afterEach(()=>vi.unstubAllGlobals());
const event:PublicRuntimeObservation={leaseId:'server-lease',captureId:'capture',languagePolicyKey:'policy:1',
  sequence:2,phase:'stopped',finalRevision:4,lastAcceptedSample:32000};
function env(secret?:string):RealtimeEnv{return {sessionEventSink:'api',apiBaseUrl:'https://api.test',
  internalApiSecret:secret,sessionSyncTimeoutMs:100} as RealtimeEnv;}
it('posts a stable authenticated observation across retries, without supplying duration',async()=>{
  const calls:Array<{url:string,body:unknown,auth:unknown}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:unknown,init:RequestInit)=>{
    calls.push({url:String(input),body:JSON.parse(String(init.body)),auth:(init.headers as Record<string,string>).authorization});
    return new Response(JSON.stringify({...event,sessionId:'session-s',deploymentId:'public-test',
      ownerId:'owner',modelPolicyRevision:'policy-v1',meterStatus:'verified'}),{status:calls.length===1?503:200});
  }));
  const sink=createSessionEventSink(env('internal-test-secret-123'));await sink.runtime!('session-s',event);
  expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);
  expect(calls[0].body).toEqual(event);expect(calls[0].url).toBe('https://api.test/internal/realtime/sessions/session-s/runtime');
  expect(calls[0].auth).toBe('Bearer internal-test-secret-123');
  expect(calls[0].body).not.toHaveProperty('billableSeconds');
});
it('missing internal credentials cannot produce a public observation',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(createSessionEventSink(env()).runtime!('session-s',event)).rejects.toThrow('internal authentication');
  expect(fetch).not.toHaveBeenCalled();
  expect(createSessionEventSink({...env(),sessionEventSink:'noop'}).runtime).toBeUndefined();
});
