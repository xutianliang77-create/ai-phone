import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {mkdtempSync,readFileSync,writeFileSync,statSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";import {join} from "node:path";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../../app.js";
import {emptyConfiguration,publicModelCatalog,type ModelComponent} from "./public-model-config.js";
import {publicModelConfigScript} from "./public-model-config-page.js";
let app:FastifyInstance,dir:string,file:string;
const auth={authorization:"Bearer synthetic-config-admin-secret"};
const uri="/models/public-config/data";
const key="ab".repeat(32);
const secrets={apiKey:"SYNTHETIC_API_SECRET",secretId:"SYNTHETIC_SECRET_ID",secretKey:"SYNTHETIC_SECRET_KEY",
  serviceAccountJson:JSON.stringify({type:"service_account",project_id:"synthetic-project",client_email:"test@synthetic.iam.gserviceaccount.com",private_key:"-----BEGIN PRIVATE KEY-----\nSYNTHETIC_ONLY\n-----END PRIVATE KEY-----"})};
function payload(protocol=publicModelCatalog.protocols[0],revision=0){
  const config=emptyConfiguration("public-config-test"),c=protocol.component;
  Object.assign(config.components[c],{enabled:true,vendor:protocol.vendor,protocol:protocol.id,authKind:protocol.auth[0],endpoint:`${protocol.scheme}//synthetic-provider.test/base`,modelId:"manual-model-id",appId:"100001",projectId:"synthetic-project",location:"global",recognizer:"_",voice:"manual-voice"});
  config.components[c].sampleRate=(protocol.capability.sampleRates[0]??16000) as 16000|24000;
  if(protocol.id==="google_speech_v2")config.components[c].languageLocales={zh:"cmn-Hans-CN",en:"en-US"};
  return {expectedRevision:revision,components:config.components,credentials:{[c]:Object.fromEntries(publicModelCatalog.credentialFields[protocol.auth[0]].map(k=>[k,secrets[k as keyof typeof secrets]]))}};
}
const save=(body:unknown)=>app.inject({method:"PUT",url:uri,headers:auth,payload:body as object});
beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),"wujie-config-test-"));file=join(dir,"public-config.enc.json");
  vi.stubEnv("PUBLIC_MODEL_CONFIG_FILE",file);vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY",key);vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-config-test");vi.stubEnv("INTERNAL_API_SECRET","synthetic-config-admin-secret");
  app=await buildApp();
});
afterEach(async()=>{await app.close();vi.unstubAllEnvs();vi.restoreAllMocks();rmSync(dir,{recursive:true,force:true});});
describe("original model domain manual public configuration",()=>{
  it("round-trips Google language locale maps without calling models and rejects malformed maps",async()=>{
    const body=payload(publicModelCatalog.protocols.find(p=>p.id==="google_speech_v2")!);expect((await save(body)).statusCode).toBe(200);
    const result=await app.inject({method:"GET",url:uri,headers:auth});expect(result.json().components.asr.languageLocales).toEqual({zh:"cmn-Hans-CN",en:"en-US"});
    const invalid={...body,expectedRevision:1,components:{...body.components,asr:{...body.components.asr,languageLocales:{en:42}}}};
    expect((await save(invalid)).statusCode).toBe(400);
  });
  it("captures the locale textarea as JSON and does not partially change draft on malformed input",()=>{
    const prefix=publicModelConfigScript.split("$('load').onclick=load;")[0];
    const inputs:Record<string,any>={"card-asr":{},"asr-languageLocales":{value:'{"en":"en-GB"}'},"asr-modelId":{value:"new-model"}};
    const document={body:{dataset:{configRoot:"/models/public-config",configKind:"public"}},getElementById:(id:string)=>inputs[id]};
    const draft={asr:{modelId:"old-model"}};
    const capture=new Function("document","initial",prefix+";draft=initial;return ()=>{capture('asr');return draft.asr;};")(document,draft);
    expect(capture()).toEqual({modelId:"new-model",languageLocales:{en:"en-GB"}});
    inputs["asr-languageLocales"].value="{bad";inputs["asr-modelId"].value="must-not-apply";expect(capture).toThrow();expect(draft.asr.modelId).toBe("new-model");
  });
  it("serves a safe editor and all four vendors for each component without secrets",async()=>{
    const page=await app.inject({url:"/models/public-config"});expect(page.statusCode).toBe(200);expect(page.body).toContain("公共模型配置");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");expect(page.headers["cache-control"]).toBe("no-store");
    const catalog=(await app.inject({url:"/models/public-config/catalog"})).json();
    for(const c of ["asr","translation","tts"])expect(new Set(catalog.protocols.filter((p:any)=>p.component===c).map((p:any)=>p.vendor))).toEqual(new Set(["qwen","tencent","openai","google"]));
    expect(()=>new Function(publicModelConfigScript)).not.toThrow();expect(publicModelConfigScript).not.toContain("localStorage");expect(page.body).not.toContain(secrets.apiKey);
    expect(publicModelConfigScript).toContain("PUBLIC_GOOGLE_ADC_FILE");expect(publicModelConfigScript).toContain("service_account / authorized_user");
  });
  it("requires admin authentication and secure transport for metadata and mutations",async()=>{
    expect((await app.inject({url:uri})).statusCode).toBe(401);
    expect((await app.inject({method:"PUT",url:uri,payload:payload()})).statusCode).toBe(401);
    expect((await app.inject({url:uri,headers:{...auth,"x-forwarded-proto":"https",host:"localhost"},remoteAddress:"203.0.113.42"})).statusCode).toBe(403);
    expect(existsSync(file)).toBe(false);
  });
  it.each(publicModelCatalog.protocols.map(p=>[p.id,p] as const))("saves and reads %s without exposing credentials or calling a provider",async(_id,p)=>{
    const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No model calls allowed"));
    const r=await save(payload(p));expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({revision:1,runtimeActivated:false,saveTriggersModelCalls:false});
    expect(r.json().components[p.component]).toMatchObject({vendor:p.vendor,protocol:p.id,modelId:"manual-model-id"});
    expect(r.json().status[p.component].state).toBe("configured_not_verified");
    const get=await app.inject({url:uri,headers:auth});expect(get.json()).toEqual(r.json());
    for(const secret of Object.values(secrets)){expect(get.body).not.toContain(secret);expect(readFileSync(file,"utf8")).not.toContain(secret);}
    expect(readFileSync(file,"utf8")).not.toContain("manual-model-id");expect(statSync(file).mode&0o777).toBe(0o600);expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves blank credentials but clears them on vendor or service-origin changes",async()=>{
    const body=payload();await save(body);const preserve={...body,expectedRevision:1,credentials:{asr:{apiKey:""}}};
    expect((await save(preserve)).json().status.asr.credentialsPresent.apiKey).toBe(true);
    const changed={...preserve,expectedRevision:2,components:structuredClone(body.components)};changed.components.asr.endpoint="wss://different.test/base";
    const r=await save(changed);expect(r.json().status.asr.credentialsPresent.apiKey).toBe(false);expect(r.json().status.asr.state).toBe("incomplete");
  });
  it("clears only explicitly selected component credentials",async()=>{
    const body=payload();await save(body);const r=await save({...body,expectedRevision:1,credentials:{},clearCredentials:["asr"]});
    expect(r.json().status.asr.credentialsPresent.apiKey).toBe(false);
  });
  it("rejects stale concurrent writes rather than overwriting another admin",async()=>{
    const replies=await Promise.all([save(payload()),save(payload())]);expect(replies.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect((await app.inject({url:uri,headers:auth})).json().revision).toBe(1);
  });
  it.each(["http://synthetic-provider.test","wss://user:secret@synthetic-provider.test","wss://synthetic-provider.test?api_key=secret"])("rejects unsafe endpoint %s without writes",async endpoint=>{
    const body=payload();body.components.asr.endpoint=endpoint;expect((await save(body)).statusCode).toBe(400);expect(existsSync(file)).toBe(false);
  });
  it("rejects mismatched provider/auth, secret fields in profiles and unknown settings",async()=>{
    for(const patch of [{vendor:"openai"},{authKind:"tencent_secret"},{apiKey:"LEAK"},{timeoutMs:0},{sampleRate:0}]){
      const body=payload();Object.assign(body.components.asr,patch);expect((await save(body)).statusCode).toBe(400);
    }
    expect(existsSync(file)).toBe(false);
  });
  it("does not overwrite unreadable encrypted config or accept another key/deployment",async()=>{
    await save(payload());const before=readFileSync(file,"utf8");vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","cd".repeat(32));
    expect((await app.inject({url:uri,headers:auth})).statusCode).toBe(503);expect((await save(payload())).statusCode).toBe(503);expect(readFileSync(file,"utf8")).toBe(before);
    vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY",key);vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","other-deployment");expect((await app.inject({url:uri,headers:auth})).statusCode).toBe(503);
  });
  it("fails closed when storage is not configured or existing content is corrupt",async()=>{
    vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","");expect((await save(payload())).statusCode).toBe(503);expect(existsSync(file)).toBe(false);
    vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY",key);writeFileSync(file,"unrelated existing content");expect((await save(payload())).statusCode).toBe(503);expect(readFileSync(file,"utf8")).toBe("unrelated existing content");
  });
  it("supports Google ADC configuration without pretending the server credentials were probed",async()=>{
    const p=publicModelCatalog.protocols.find(p=>p.id==="google_speech_v2")!,body=payload(p);body.components.asr.authKind="google_adc";body.credentials={asr:{}};
    const r=await save(body);expect(r.statusCode).toBe(200);expect(r.json().status.asr).toMatchObject({state:"configured_not_verified",credentialsPresent:{}});
  });
});
