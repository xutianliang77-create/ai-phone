import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../../app.js";
import {installConfigurationFixture} from "../sessions/public-model-configuration.test-support.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
let app:FastifyInstance;const resolve=vi.fn(async()=>{throw Error("Must not resolve model evidence");});
installConfigurationFixture();
beforeEach(async()=>{vi.stubEnv("REALTIME_WS_ENDPOINT","wss://gateway.synthetic.invalid/realtime");vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");
  app=await buildApp({publicRealtimeAuthority:{timeoutMs:1000,resolveVerifiedEvidence:resolve}});});
afterEach(async()=>{await app.close();resolve.mockClear();});
describe("authenticated mobile public creation context",()=>{
  it.each(["true","false"])("describes enabled voice=%s without models, grants or holds",async voice=>{
    const before=structuredClone({sessions:getStoreSnapshot().sessions,holds:getStoreSnapshot().usageHolds});
    const r=await app.inject({url:`/realtime/sessions/configuration?voiceOutput=${voice}`});expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({contractVersion:1,deploymentId:"runtime-test",ownerId:"guest-user",captureSampleRate:16000,voiceOutput:voice==="true",status:"configured_not_verified"});
    expect(r.json().executionPlan.tts.execution).toBe(voice==="true"?"public":"disabled");expect(r.body).not.toMatch(/apiKey|SYNTHETIC|publicGrantRef|credentials/);
    expect(r.headers["cache-control"]).toBe("no-store");expect(resolve).not.toHaveBeenCalled();
    expect({sessions:getStoreSnapshot().sessions,holds:getStoreSnapshot().usageHolds}).toEqual(before);
  });
  it("retains default activation and account gates",async()=>{
    vi.stubEnv("API_TEST_AUTO_ACCOUNT","false");expect((await app.inject({url:"/realtime/sessions/configuration?voiceOutput=false"})).statusCode).toBe(401);
    await app.close();app=await buildApp();vi.stubEnv("API_TEST_AUTO_ACCOUNT","true");expect((await app.inject({url:"/realtime/sessions/configuration?voiceOutput=false"})).statusCode).toBe(503);
  });
  it.each(["","?voiceOutput=auto","?voiceOutput=false&ownerId=other"])("rejects malformed context query %s",async query=>{
    expect((await app.inject({url:`/realtime/sessions/configuration${query}`})).statusCode).toBe(400);expect(resolve).not.toHaveBeenCalled();
  });
});
