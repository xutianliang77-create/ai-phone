import {describe,it,expect} from "vitest";
import {publicModelProtocolCapabilities,publicProtocolCapability,publicProtocolSampleRateSupported} from "./public-model-capabilities.js";
describe("implemented public wire capabilities",()=>{
  it("covers four vendors and three components without granting readiness",()=>{
    const values=Object.values(publicModelProtocolCapabilities);expect(values).toHaveLength(15);
    for(const component of ["asr","translation","tts"])expect(new Set(values.filter(c=>c.component===component).map(c=>c.vendor))).toEqual(new Set(["qwen","tencent","openai","google"]));
    for(const c of values){expect(c).not.toHaveProperty("ready");expect(c).not.toHaveProperty("qualified");expect(Object.isFrozen(c)).toBe(true);expect(Object.isFrozen(c.sampleRates)).toBe(true);}
  });
  it.each(["__proto__","constructor","private_asr",""])("rejects unknown %s instead of a fallback",id=>{
    expect(publicProtocolCapability(id)).toBeUndefined();expect(publicProtocolSampleRateSupported(id,16000)).toBe(false);
  });
  it.each([["qwen_asr_realtime",16000,24000],["tencent_asr_ws",16000,24000],["openai_realtime_asr",24000,16000],["qwen_tts_realtime",24000,16000],["openai_speech",24000,16000]] as const)("pins %s's implemented rate",(id,accepted,rejected)=>{
    expect(publicProtocolSampleRateSupported(id,accepted)).toBe(true);expect(publicProtocolSampleRateSupported(id,rejected)).toBe(false);
  });
  it.each(["qwen_asr_compatible","openai_transcriptions"])("does not expose %s as continuous input",id=>{
    expect(publicProtocolCapability(id)).toMatchObject({input:"completed_pcm",output:"completed_transcript",maxAudioSeconds:30});
    expect(publicProtocolSampleRateSupported(id,16000)).toBe(true);expect(publicProtocolSampleRateSupported(id,24000)).toBe(true);
  });
  it("distinguishes Google complete TTS from chunked PCM and does not treat MT as audio",()=>{
    expect(publicProtocolCapability("google_cloud_tts")).toMatchObject({output:"completed_pcm",maxTextUtf8Bytes:5000});
    expect(publicProtocolSampleRateSupported("qwen_chat",16000)).toBe(false);
  });
});
