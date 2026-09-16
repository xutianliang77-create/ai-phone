/** Constraints of the implemented adapters, not a supplier/model qualification
 * catalogue. A matching entry never grants network access or production readiness. */
export interface PublicModelProtocolCapability {
  vendor:"qwen"|"tencent"|"openai"|"google";
  component:"asr"|"translation"|"tts";
  transport:"https"|"websocket"|"grpc";
  input:"continuous_pcm"|"completed_pcm"|"text";
  output:"transcript_events"|"completed_transcript"|"text"|"streamed_pcm"|"completed_pcm";
  sampleRates:readonly number[];
  languageConstraint:string;
  /** Implemented adapter support only. A true value still requires the
   * separately signed policy and live qualification for the exact model
   * configuration; it never enables automatic routing on its own. */
  automaticLanguage:boolean;
  maxAudioSeconds?:number;
  maxTextCodepoints?:number;
  maxTextUtf8Bytes?:number;
}
const asr=(vendor:PublicModelProtocolCapability["vendor"],transport:PublicModelProtocolCapability["transport"],
  sampleRates:number[],languageConstraint:string,completed=false,automaticLanguage=false):PublicModelProtocolCapability=>({vendor,component:"asr",transport,
  input:completed?"completed_pcm":"continuous_pcm",output:completed?"completed_transcript":"transcript_events",
  sampleRates,languageConstraint,automaticLanguage,maxAudioSeconds:30});
const mt=(vendor:PublicModelProtocolCapability["vendor"]):PublicModelProtocolCapability=>({vendor,component:"translation",transport:"https",
  input:"text",output:"text",sampleRates:[],languageConstraint:"明确产品语言对；具体模型/地域资格另验",automaticLanguage:false,maxTextUtf8Bytes:65536});
const tts=(vendor:PublicModelProtocolCapability["vendor"],transport:PublicModelProtocolCapability["transport"],sampleRates:number[],
  languageConstraint:string,completed=false):PublicModelProtocolCapability=>({vendor,component:"tts",transport,input:"text",
  output:completed?"completed_pcm":"streamed_pcm",sampleRates,languageConstraint,automaticLanguage:false,maxTextCodepoints:4096,
  ...(vendor==="google"?{maxTextUtf8Bytes:5000}:{})});
const protocols:Record<string,PublicModelProtocolCapability>={
  qwen_asr_realtime:asr("qwen","websocket",[16000],"源语言可省略以自动识别；自动路由当前限中英对且须逐配置资格化",false,true),
  qwen_asr_compatible:asr("qwen","https",[16000,24000],"明确源语言；已实现21种产品语言交集；非Filetrans异步接口",true),
  qwen_chat:mt("qwen"),
  qwen_tts_realtime:tts("qwen","websocket",[24000],"明确目标语种：zh/en/de/it/pt/es/ja/ko/fr/ru；Voice资格另验"),
  tencent_asr_ws:asr("tencent","websocket",[16000],"默认须匹配16k引擎；仅16k_zh_en_2.0可作中英自动路由，仍须逐配置资格化"),
  tencent_hunyuan_chat:mt("tencent"),
  tencent_tmt:mt("tencent"),
  tencent_tts_ws:tts("tencent","websocket",[16000,24000],"明确zh/en；VoiceType资格另验，不支持SSML/复刻"),
  openai_transcriptions:asr("openai","https",[16000,24000],"可省略源语言；当前自动路由实现仅支持中英对，仍须逐配置资格化",true,true),
  openai_realtime_asr:asr("openai","websocket",[24000],"可省略源语言；当前自动路由实现仅支持中英对，仍须逐配置资格化",false,true),
  openai_chat:mt("openai"),
  openai_speech:tts("openai","https",[24000],"明确目标语种；手填Voice的实际语言能力另验"),
  google_speech_v2:asr("google","grpc",[16000,24000],"源语言从显式languageLocales映射；model/region资格另验"),
  google_gemini:mt("google"),
  google_vertex_gemini:mt("google"),
  google_cloud_tts:tts("google","https",[16000,24000],"Voice locale必须匹配目标语种；命名声音资格另验",true),
};
// Keep consumers from silently changing the shared policy in-process.
for(const value of Object.values(protocols)){Object.freeze(value.sampleRates);Object.freeze(value);}
export const publicModelProtocolCapabilities:Readonly<Record<string,Readonly<PublicModelProtocolCapability>>>=Object.freeze(protocols);
export function publicProtocolCapability(protocol:string){
  return Object.hasOwn(publicModelProtocolCapabilities,protocol)?publicModelProtocolCapabilities[protocol]:undefined;
}
export function publicProtocolSampleRateSupported(protocol:string,sampleRate:number){
  const capability=publicProtocolCapability(protocol);
  return capability?.component!=="translation"&&capability?.sampleRates.includes(sampleRate)===true;
}

/** Adapter capability only. Callers must combine this with the exact signed
 * admission policy and, where required, live qualification evidence. */
export function publicProtocolAutomaticLanguageSupported(protocol:string){
  return publicProtocolCapability(protocol)?.component === "asr" &&
    publicProtocolCapability(protocol)?.automaticLanguage === true;
}

/** Tencent's wire protocol covers both fixed-locale engines and the separate
 * 16k_zh_en_2.0 bilingual engine.  The protocol alone must not turn a fixed
 * `16k_en` or `16k_zh` configuration into automatic language recognition. */
export function publicAsrModelAutomaticLanguageSupported(protocol:string,modelId:string){
  return publicProtocolAutomaticLanguageSupported(protocol) ||
    protocol === "tencent_asr_ws" && modelId === "16k_zh_en_2.0";
}

/** The existing inherited text-language router has only been implemented for
 * the Chinese/English pair. This is an adapter limit, not a rewrite of the
 * selected language parameters: callers still pass and sign the exact pair. */
export function publicProtocolAutomaticLanguagePairSupported(
  protocol:string,
  pair:readonly string[]|undefined,
){
  return publicProtocolAutomaticLanguageSupported(protocol)&&pair?.length===2&&
    new Set(pair).size===2&&pair.includes("zh")&&pair.includes("en");
}

/** The inherited router is deliberately bounded to the Chinese/English pair.
 * Model support is only an implementation capability; signed policy and live
 * qualification still decide whether a configured public deployment may use it. */
export function publicAsrModelAutomaticLanguagePairSupported(
  protocol:string,
  modelId:string,
  pair:readonly string[]|undefined,
){
  return publicAsrModelAutomaticLanguageSupported(protocol,modelId)&&
    pair?.length===2&&new Set(pair).size===2&&pair.includes("zh")&&pair.includes("en");
}
