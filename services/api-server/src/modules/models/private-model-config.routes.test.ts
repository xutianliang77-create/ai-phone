import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,copyFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";import {join} from "node:path";import type {FastifyInstance} from "fastify";
import {createCipheriv} from "node:crypto";
import {buildApp} from "../../app.js";
import {emptyPrivateConfiguration,privateModelCatalog} from "./private-model-config.js";
import {emptyConfiguration} from "./public-model-config.js";
const uri="/models/private-config/data",auth={authorization:"Bearer synthetic-private-admin-secret"};
let app:FastifyInstance,dir:string,file:string,publicFile:string;
const secret="SYNTHETIC_PRIVATE_SERVICE_KEY";
function payload(protocol=privateModelCatalog.protocols[0],revision=0){
  const config=emptyPrivateConfiguration("private-test"),c=protocol.component as "asr"|"translation"|"tts";
  Object.assign(config.components[c],{enabled:true,vendor:protocol.vendor,protocol:protocol.id,endpoint:"http://private-model.test:8001/service",healthUrl:"http://private-model.test:8001/health",modelId:"private-manual-model"});
  if(c==="asr")config.components[c].flushEndpoint="http://private-model.test:8001/asr/sessions/:sessionId/flush";
  if(c==="tts")config.components[c].streamEndpoint="http://private-model.test:8001/tts/stream";
  return {expectedRevision:revision,components:config.components,credentials:{[c]:{apiKey:secret}}};
}
const save=(body:unknown)=>app.inject({method:"PUT",url:uri,headers:auth,payload:body as object});
beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),"wujie-private-config-"));file=join(dir,"private.enc.json");publicFile=join(dir,"public.enc.json");
  vi.stubEnv("PRIVATE_MODEL_CONFIG_FILE",file);vi.stubEnv("PRIVATE_MODEL_CONFIG_KEY","ab".repeat(32));vi.stubEnv("PRIVATE_MODEL_CONFIG_DEPLOYMENT_ID","private-test");
  vi.stubEnv("PUBLIC_MODEL_CONFIG_FILE",publicFile);vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","cd".repeat(32));vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","");vi.stubEnv("INTERNAL_API_SECRET","synthetic-private-admin-secret");
  app=await buildApp();
});
afterEach(async()=>{await app.close();vi.unstubAllEnvs();vi.restoreAllMocks();rmSync(dir,{recursive:true,force:true});});
describe("private cloud configuration in the existing management editor",()=>{
  it("serves both navigation links and private-only fields without requiring a public deployment flag",async()=>{
    const page=await app.inject({url:"/models/private-config"});expect(page.statusCode).toBe(200);
    expect(page.body).toContain('data-config-root="/models/private-config"');expect(page.body).toContain("私有云配置");expect(page.body).toContain('href="/models/public-config"');
    const catalog=(await app.inject({url:"/models/private-config/catalog"})).json();expect(catalog.protocols).toHaveLength(5);
    expect(catalog.editorFields.map((f:string[])=>f[0])).toEqual(expect.arrayContaining(["healthUrl","flushEndpoint","streamEndpoint"]));
    expect((await app.inject({url:uri,headers:auth})).statusCode).toBe(200);expect(process.env.API_RESULT_SYNC_DEPLOYMENT_ID).toBe("");
  });
  it.each(privateModelCatalog.protocols.map(p=>[p.id,p] as const))("stores %s with private HTTP and no model calls or plaintext credential readback",async(_id,p)=>{
    const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("must not probe models"));const r=await save(payload(p));expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({revision:1,runtimeActivated:false,existingPrivateRuntimeModified:false});
    expect(r.json().status[p.component].state).toBe("configured_not_verified");expect(r.body).not.toContain(secret);expect(readFileSync(file,"utf8")).not.toContain(secret);
    expect((await app.inject({url:uri,headers:auth})).json()).toEqual(r.json());expect(fetch).not.toHaveBeenCalled();
  });
  it("retains credentials, supports explicit clear, and rejects concurrent stale saves",async()=>{
    const body=payload();await save(body);
    const replies=await Promise.all([save({...body,expectedRevision:1,credentials:{}}),save({...body,expectedRevision:1,credentials:{}})]);
    expect(replies.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect(replies.find(r=>r.statusCode===200)!.json().status.asr.credentialsPresent.apiKey).toBe(true);
    expect((await save({...body,expectedRevision:2,credentials:{},clearCredentials:["asr"]})).json().status.asr.credentialsPresent.apiKey).toBe(false);
  });
  it("does not share revisions or change public config bytes and legacy route files",async()=>{
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");const legacy=join(dir,"original-route.json");writeFileSync(legacy,'{"unchanged":true}');vi.stubEnv("MODEL_ROUTING_FILE",legacy);
    const pub=emptyConfiguration("public-test");const p=await app.inject({method:"PUT",url:"/models/public-config/data",headers:auth,payload:{expectedRevision:0,components:pub.components}});expect(p.statusCode).toBe(200);
    const publicBefore=readFileSync(publicFile,"utf8");expect((await save(payload())).statusCode).toBe(200);
    expect(readFileSync(publicFile,"utf8")).toBe(publicBefore);expect(readFileSync(legacy,"utf8")).toBe('{"unchanged":true}');
    expect((await app.inject({url:"/models/public-config/data",headers:auth})).json().revision).toBe(1);
  });
  it("rejects reusing the same file path for public and private storage",async()=>{
    vi.stubEnv("PUBLIC_MODEL_CONFIG_FILE",file);expect((await save(payload())).json().error.code).toBe("model_config_storage_collision");expect(existsSync(file)).toBe(false);
  });
  it("cannot decode public ciphertext even with the same key and deployment name",async()=>{
    vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","ab".repeat(32));vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","private-test");
    await app.inject({method:"PUT",url:"/models/public-config/data",headers:auth,payload:{expectedRevision:0,components:emptyConfiguration("private-test").components}});
    copyFileSync(publicFile,file);const before=readFileSync(file,"utf8");expect((await app.inject({url:uri,headers:auth})).statusCode).toBe(503);
    expect((await save(payload())).statusCode).toBe(503);expect(readFileSync(file,"utf8")).toBe(before);
  });
  it("retains compatibility with the previously shipped public encryption envelope",async()=>{
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");const config=emptyConfiguration("public-test");config.revision=7;config.credentials.asr.apiKey="SYNTHETIC_OLD_KEY";
    const iv=Buffer.alloc(12,1),cipher=createCipheriv("aes-256-gcm",Buffer.from("cd".repeat(32),"hex"),iv);cipher.setAAD(Buffer.from("wujie-public-models-v1:public-test"));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(config),"utf8"),cipher.final()]);
    writeFileSync(publicFile,JSON.stringify({schemaVersion:1,algorithm:"aes-256-gcm",iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")}));
    const r=await app.inject({url:"/models/public-config/data",headers:auth});expect(r.statusCode).toBe(200);expect(r.json().revision).toBe(7);expect(r.json().status.asr.credentialsPresent.apiKey).toBe(true);expect(r.body).not.toContain("SYNTHETIC_OLD_KEY");
  });
  it("requires management auth and safe management transport despite allowing private model HTTP",async()=>{
    expect((await app.inject({url:uri})).statusCode).toBe(401);
    expect((await app.inject({url:uri,headers:{...auth,host:"localhost","x-forwarded-proto":"https"},remoteAddress:"203.0.113.9"})).statusCode).toBe(403);
    expect(existsSync(file)).toBe(false);
  });
  it.each(["file:///etc/passwd","http://user:password@private.test","http://private.test?api_key=secret","wss://private.test"])("rejects unsafe model endpoint %s",async endpoint=>{
    const body=payload();body.components.asr.endpoint=endpoint;expect((await save(body)).statusCode).toBe(400);expect(existsSync(file)).toBe(false);
  });
  it("rejects cross-origin auxiliary requests and public-only fields",async()=>{
    const body=payload();body.components.asr.healthUrl="http://other.test/health";expect((await save(body)).statusCode).toBe(400);
    const extra=payload();Object.assign(extra.components.asr,{projectId:"public-only"});expect((await save(extra)).statusCode).toBe(400);
  });
  it("can save an explicit no-auth private profile without weakening the management API",async()=>{
    const body=payload();body.components.asr.authKind="none";body.credentials={asr:{}};
    const r=await save(body);expect(r.statusCode).toBe(200);expect(r.json().status.asr.credentialsPresent).toEqual({});
    expect((await app.inject({url:uri})).statusCode).toBe(401);
  });
});
