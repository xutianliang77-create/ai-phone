import {afterEach,it,expect,vi} from "vitest";
import {emptyConfiguration,mergeConfiguration,validateProfile,publicModelCatalog} from "./public-model-config.js";
import * as store from "./public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration,resolvePublicModelRuntimeCredentials} from "./public-model-runtime-config.js";
import {publicModelConfigScript} from "./public-model-config-page.js";
afterEach(()=>vi.restoreAllMocks());
function config(){const c=emptyConfiguration("vad-audit");c.revision=1;
  for(const key of ["asr","translation"] as const){Object.assign(c.components[key],{enabled:true,endpoint:key==="asr"?"wss://synthetic.invalid":"https://synthetic.invalid",modelId:"manual"});c.credentials[key]={apiKey:"SYNTHETIC"};}return c;}
it("preserves omitted legacy VAD identity and signs explicit changes in both runtime snapshots",()=>{
  let current=config();Object.assign(current.components.tts,{enabled:true,endpoint:"wss://synthetic.invalid",modelId:"voice",voice:"voice"});current.credentials.tts={apiKey:"SYNTHETIC"};
  vi.spyOn(store,"selectPublicModelConfigurationInternal").mockImplementation(select=>select(current));
  const old=[false,true].map(capturePublicModelRuntimeConfiguration),frozen=structuredClone(old);
  expect(old[0].components.asr).not.toHaveProperty("serverVad");expect(current.components.asr).not.toHaveProperty("serverVad");
  expect([false,true].map(capturePublicModelRuntimeConfiguration)).toEqual(old);
  const components=structuredClone(current.components);components.asr.serverVad={threshold:0,silenceDurationMs:800};
  current=mergeConfiguration(current,{expectedRevision:1,components});
  for(const [i,voice]of [false,true].entries()){
    const next=capturePublicModelRuntimeConfiguration(voice);expect(next.components.asr!.serverVad).toEqual(components.asr.serverVad);
    expect(next.configurationHash).not.toBe(old[i].configurationHash);expect(next.modelPolicyRevision).not.toBe(old[i].modelPolicyRevision);
    expect(()=>resolvePublicModelRuntimeCredentials(old[i],"asr")).toThrow("config_changed");
  }
  expect(old).toEqual(frozen);
});
it("rejects a carried Qwen knob on other ASR protocols and non-ASR components",()=>{
  const c=config();const vad={threshold:0,silenceDurationMs:800};
  for(const p of publicModelCatalog.protocols.filter(p=>p.component==="asr"&&p.id!=="qwen_asr_realtime")){
    expect(()=>validateProfile("asr",{...c.components.asr,protocol:p.id,vendor:p.vendor,authKind:p.auth[0],serverVad:vad})).toThrow("invalid_server_vad");
  }
  expect(()=>validateProfile("translation",{...c.components.translation,serverVad:vad})).toThrow("invalid_server_vad");
});
it("editor explicitly opts into tuning, rejects bad input atomically and can return to legacy defaults",()=>{
  const prefix=publicModelConfigScript.split("$('load').onclick=load;")[0];
  const inputs:Record<string,any>={"card-asr":{},"asr-modelId":{value:"new"},"asr-serverVad-override":{checked:false},
    "asr-serverVad-threshold":{value:"0"},"asr-serverVad-silenceDurationMs":{value:"800"}};
  const doc={body:{dataset:{configRoot:"/models/public-config",configKind:"public"}},getElementById:(id:string)=>inputs[id]};
  const draft={asr:config().components.asr};
  const capture=new Function("document","initial","cat",prefix+";draft=initial;catalog=cat;return ()=>{capture('asr');return draft.asr;};")(doc,draft,publicModelCatalog);
  expect(capture()).not.toHaveProperty("serverVad");inputs["asr-serverVad-override"].checked=true;
  expect(capture().serverVad).toEqual({threshold:0,silenceDurationMs:800});
  inputs["asr-modelId"].value="must-not-apply";inputs["asr-serverVad-threshold"].value="";
  expect(capture).toThrow();expect(draft.asr.modelId).toBe("new");
  inputs["asr-serverVad-override"].checked=false;expect(capture()).not.toHaveProperty("serverVad");
});
it.each(["vendor","protocol"])("editor drops Qwen-only VAD when switching %s, instead of poisoning the next model",kind=>{
  const nodes:Record<string,any>={message:{}},created:any[]=[];
  const document={body:{dataset:{configRoot:"/models/public-config",configKind:"public"}},getElementById:(id:string)=>nodes[id],
    createTextNode:(text:string)=>({textContent:text}),createElement:(tag:string)=>{
      const node:any={tag,children:[],dataset:{},append(...children:any[]){this.children.push(...children);},replaceWith(){}};
      Object.defineProperty(node,"id",{set(id:string){nodes[id]=node;},get(){return Object.keys(nodes).find(key=>nodes[key]===node);}});
      created.push(node);return node;
    }};
  const initial={asr:{...config().components.asr,serverVad:{threshold:0,silenceDurationMs:800}}};
  const prefix=publicModelConfigScript.split("$('load').onclick=load;")[0];
  new Function("document","initial","cat",prefix+";draft=initial;catalog=cat;card('asr');")(document,initial,publicModelCatalog);
  expect(nodes["asr-serverVad-threshold"]).toMatchObject({type:"number",min:"-1",max:"1",disabled:false});
  nodes["asr-serverVad-threshold"].value="0";nodes["asr-serverVad-silenceDurationMs"].value="800";
  const input=nodes[`asr-${kind}`];input.value=kind==="vendor"?"tencent":"qwen_asr_compatible";input.onchange();
  expect(initial.asr).not.toHaveProperty("serverVad");
  expect(initial.asr.protocol).toBe(kind==="vendor"?"tencent_asr_ws":"qwen_asr_compatible");
});
