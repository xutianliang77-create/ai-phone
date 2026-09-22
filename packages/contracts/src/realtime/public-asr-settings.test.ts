import {it,expect} from "vitest";
import {resolvePublicAsrServerVad,publicAsrServerVadCapability} from "./public-asr-settings.js";
it("keeps legacy Qwen defaults without advertising VAD knobs for other protocols",()=>{
  expect(resolvePublicAsrServerVad("qwen_asr_realtime")).toEqual({threshold:0.2,silenceDurationMs:400});
  for(const protocol of ["openai_realtime_asr","tencent_asr_ws","google_speech_v2","qwen_tts_realtime"]){
    expect(publicAsrServerVadCapability(protocol)).toBeUndefined();expect(resolvePublicAsrServerVad(protocol)).toBeUndefined();
    expect(()=>resolvePublicAsrServerVad(protocol,{threshold:0.2,silenceDurationMs:400})).toThrow();
  }
});
it.each([{threshold:-1,silenceDurationMs:200},{threshold:1,silenceDurationMs:6000},{threshold:0,silenceDurationMs:800}])("accepts documented Qwen bounds %j",value=>{
  expect(resolvePublicAsrServerVad("qwen_asr_realtime",value)).toEqual(value);
  expect(resolvePublicAsrServerVad("qwen_asr_realtime",value)).not.toBe(value);
});
it.each([null,[],"0",{}, {threshold:0}, {threshold:"0",silenceDurationMs:400},
  {threshold:NaN,silenceDurationMs:400},{threshold:Infinity,silenceDurationMs:400},
  {threshold:1.1,silenceDurationMs:400},{threshold:-1.1,silenceDurationMs:400},
  {threshold:0,silenceDurationMs:199},{threshold:0,silenceDurationMs:6001},{threshold:0,silenceDurationMs:400.5},
  {threshold:0,silenceDurationMs:400,mode:"manual"}])("rejects invalid/unknown settings %j",value=>{
  expect(()=>resolvePublicAsrServerVad("qwen_asr_realtime",value)).toThrow("invalid_server_vad");
});
