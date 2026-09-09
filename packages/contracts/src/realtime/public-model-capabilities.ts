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
  maxAudioSeconds?:number;
  maxTextCodepoints?:number;
  maxTextUtf8Bytes?:number;
}
const asr=(vendor:PublicModelProtocolCapability["vendor"],transport:PublicModelProtocolCapability["transport"],
  sampleRates:number[],languageConstraint:string,completed=false):PublicModelProtocolCapability=>({vendor,component:"asr",transport,
  input:completed?"completed_pcm":"continuous_pcm",output:completed?"completed_transcript":"transcript_events",
  sampleRates,languageConstraint,maxAudioSeconds:30});
const mt=(vendor:PublicModelProtocolCapability["vendor"]):PublicModelProtocolCapability=>({vendor,component:"translation",transport:"https",
  input:"text",output:"text",sampleRates:[],languageConstraint:"明确产品语言对；具体模型/地域资格另验",maxTextUtf8Bytes:65536});
const tts=(vendor:PublicModelProtocolCapability["vendor"],transport:PublicModelProtocolCapability["transport"],sampleRates:number[],
  languageConstraint:string,completed=false):PublicModelProtocolCapability=>({vendor,component:"tts",transport,input:"text",
  output:completed?"completed_pcm":"streamed_pcm",sampleRates,languageConstraint,maxTextCodepoints:4096,
  ...(vendor==="google"?{maxTextUtf8Bytes:5000}:{})});
const protocols:Record<string,PublicModelProtocolCapability>={
  qwen_asr_realtime:asr("qwen","websocket",[16000],"明确源语言；已实现21种产品语言交集"),
  qwen_asr_compatible:asr("qwen","https",[16000,24000],"明确源语言；已实现21种产品语言交集；非Filetrans异步接口",true),
  qwen_chat:mt("qwen"),
  qwen_tts_realtime:tts("qwen","websocket",[24000],"明确目标语种：zh/en/de/it/pt/es/ja/ko/fr/ru；Voice资格另验"),
  tencent_asr_ws:asr("tencent","websocket",[16000],"源语言必须匹配已实现的16k引擎类型"),
  tencent_hunyuan_chat:mt("tencent"),
  tencent_tts_ws:tts("tencent","websocket",[16000,24000],"明确zh/en；VoiceType资格另验，不支持SSML/复刻"),
  openai_transcriptions:asr("openai","https",[16000,24000],"明确两字母产品源语言；模型资格另验",true),
  openai_realtime_asr:asr("openai","websocket",[24000],"明确两字母产品源语言；精确配置ACK"),
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
