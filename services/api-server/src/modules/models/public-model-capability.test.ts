import {afterEach,describe,it,expect,vi} from "vitest";
import {publicModelProtocolCapabilities} from "@translation/contracts";
import {publicModelCatalog,emptyConfiguration,validateProfile,publicConfiguration,mergeConfiguration} from "./public-model-config.js";
import {publicModelConfigScript} from "./public-model-config-page.js";
import * as store from "./public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration} from "./public-model-runtime-config.js";
afterEach(()=>vi.restoreAllMocks());
const helpers=()=>{
  const prefix=publicModelConfigScript.split("$('load').onclick=load;")[0];
  return new Function("document",prefix+";return {sampleRateItems,capabilityText};")({body:{dataset:{configRoot:"/models/public-config",configKind:"public"}}});
};
describe("manual configuration uses actual wire constraints",()=>{
  it("does not require a legacy invalid TTS rate for a speech-disabled session",()=>{
    const config=emptyConfiguration("test");config.revision=1;
    for(const c of ["asr","translation","tts"] as const){Object.assign(config.components[c],{enabled:true,
      endpoint:c==="translation"?"https://synthetic.invalid/v1":"wss://synthetic.invalid",modelId:"manual",voice:"manual"});config.credentials[c]={apiKey:"SYNTHETIC"};}
    config.components.tts.sampleRate=16000;
    vi.spyOn(store,"selectPublicModelConfigurationInternal").mockImplementation(select=>select(config));
    expect(capturePublicModelRuntimeConfiguration(false).components).not.toHaveProperty("tts");
    expect(()=>capturePublicModelRuntimeConfiguration(true)).toThrow("public_runtime_config_invalid");
    expect(config.components.tts).toMatchObject({enabled:true,sampleRate:16000});expect(config.revision).toBe(1);
  });
  it("keeps the editor catalogue in sync with every implemented protocol",()=>{
    expect(publicModelCatalog.protocols.map(p=>p.id).sort()).toEqual(Object.keys(publicModelProtocolCapabilities).sort());
    for(const p of publicModelCatalog.protocols)expect(p.capability).toBe(publicModelProtocolCapabilities[p.id]);
  });
  it.each(publicModelCatalog.protocols.filter(p=>p.component!=="translation").map(p=>[p.id,p] as const))("validates %s at save time without modifying the requested rate",(_,p)=>{
    const config=emptyConfiguration("test"),profile={...config.components[p.component],enabled:true,vendor:p.vendor,protocol:p.id,authKind:p.auth[0]};
    for(const rate of [16000,24000] as const){profile.sampleRate=rate;
      if(p.capability.sampleRates.includes(rate))expect(validateProfile(p.component,profile).sampleRate).toBe(rate);
      else expect(()=>validateProfile(p.component,profile)).toThrow("unsupported_sample_rate");
      expect(profile.sampleRate).toBe(rate);
    }
  });
  it("keeps old invalid configurations readable and repairable without rewriting their rate",()=>{
    const old=emptyConfiguration("test");old.components.tts.enabled=true;old.components.tts.sampleRate=16000;
    expect(publicConfiguration(old).status.tts).toMatchObject({state:"incomplete",missing:expect.arrayContaining(["sampleRate"])});
    expect(old.components.tts.sampleRate).toBe(16000);
    expect(()=>mergeConfiguration(old,{expectedRevision:0,components:old.components})).toThrow("unsupported_sample_rate");
    const fixed=structuredClone(old.components);fixed.tts.sampleRate=24000;
    expect(mergeConfiguration(old,{expectedRevision:0,components:fixed}).components.tts.sampleRate).toBe(24000);
  });
  it("allows disabled drafts but uses a valid default for newly configured Qwen TTS",()=>{
    const config=emptyConfiguration("test");expect(config.components.tts.sampleRate).toBe(24000);
    config.components.tts.sampleRate=16000;expect(validateProfile("tts",config.components.tts).sampleRate).toBe(16000);
  });
  it("shows an incompatible saved value explicitly rather than silently changing it",()=>{
    const h=helpers(),p=publicModelCatalog.protocols.find(p=>p.id==="openai_realtime_asr")!;
    expect(h.sampleRateItems(p,24000)).toEqual([{id:"24000",label:"24000 Hz"}]);
    expect(h.sampleRateItems(p,16000)).toEqual([{id:"16000",label:expect.stringContaining("不支持")},{id:"24000",label:"24000 Hz"}]);
    expect(h.sampleRateItems({},16000)).toHaveLength(2); // Private editor unchanged.
  });
  it("explains file versus continuous input without claiming model qualification",()=>{
    const h=helpers();for(const id of ["qwen_asr_compatible","openai_transcriptions"]){const p=publicModelCatalog.protocols.find(p=>p.id===id)!;
      expect(h.capabilityText(p)).toContain("不能代实时采音");expect(h.capabilityText(p)).toContain("不代表模型已验证");}
    expect(h.capabilityText({})).toBe("");
  });
});
