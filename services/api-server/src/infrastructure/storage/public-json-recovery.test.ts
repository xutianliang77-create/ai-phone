import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const fixture=vi.hoisted(()=>({path:"/synthetic/public-recovery/store.json",content:"{}",exists:true,unreadable:false}));
vi.mock("node:fs",async original=>{
  const fs=await original<typeof import("node:fs")>();
  return {...fs,existsSync:(path:unknown)=>path===fixture.path?fixture.exists:fs.existsSync(path as string),
    readFileSync:(path:unknown,...args:any[])=>{
      if(path!==fixture.path)return (fs.readFileSync as any)(path,...args);
      if(fixture.unreadable)throw Error("synthetic read denial");return fixture.content;
    }};
});
beforeEach(()=>{vi.resetModules();Object.assign(fixture,{content:"{}",exists:true,unreadable:false});vi.stubEnv("NODE_ENV","production");vi.stubEnv("VITEST","");
  vi.stubEnv("API_STORAGE_DRIVER","json");vi.stubEnv("API_DATA_FILE",fixture.path);vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");});
afterEach(()=>vi.unstubAllEnvs());
const load=async()=>{const m=await import("./json-store.js");return m.getStoreSnapshot();};
describe("public JSON store never loses request tombstones through empty fallback",()=>{
  it.each(["{broken","null","[]",'{"publicCreationBindings":{"bad":"cancelled:bad"}}'])("rejects %s instead of accepting a new empty public store",async raw=>{
    fixture.content=raw;await expect(load()).rejects.toThrow("refusing empty-store recovery");
  });
  it("rejects an unreadable existing public snapshot",async()=>{fixture.unreadable=true;await expect(load()).rejects.toThrow("refusing empty-store recovery");});
  it("preserves cancellation and expiry tombstones on reload",async()=>{
    const bindings={[`public-${"a".repeat(64)}`]:`cancelled:${"b".repeat(64)}`,[`public-${"c".repeat(64)}`]:`expired:${"d".repeat(64)}`};
    fixture.content=JSON.stringify({publicCreationBindings:bindings});expect((await load()).publicCreationBindings).toEqual(bindings);
  });
  it("allows a missing file for an actually new deployment",async()=>{fixture.exists=false;expect((await load()).sessions).toEqual([]);});
  it("keeps valid old snapshots without an index compatible",async()=>{expect((await load()).sessions).toEqual([]);});
  it("does not change the legacy private fallback in this slice",async()=>{vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","");fixture.content="{broken";expect((await load()).sessions).toEqual([]);});
});
