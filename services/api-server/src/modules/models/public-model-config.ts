import {publicProtocolCapability,publicProtocolSampleRateSupported,type PublicModelProtocolCapability} from "@translation/contracts";
export const modelComponents=["asr","translation","tts"] as const;
export type ModelComponent=typeof modelComponents[number];
export type Vendor="qwen"|"tencent"|"openai"|"google";
export type AuthKind="api_key"|"tencent_secret"|"google_service_account"|"google_adc";
export interface PublicModelProfile {
  languageLocales?:Record<string,string>;
  enabled:boolean;vendor:Vendor;protocol:string;endpoint:string;modelId:string;authKind:AuthKind;
  region:string;appId:string;projectId:string;location:string;recognizer:string;voice:string;
  timeoutMs:number;maxTokens:number;sampleRate:16000|24000;
}
export type Credentials=Partial<Record<"apiKey"|"secretId"|"secretKey"|"serviceAccountJson",string>>;
export interface PublicModelConfiguration {schemaVersion:1;deploymentId:string;revision:number;updatedAt:string;
  components:Record<ModelComponent,PublicModelProfile>;credentials:Record<ModelComponent,Credentials>;}
interface Protocol {id:string;label:string;vendor:Vendor;component:ModelComponent;scheme:"https:"|"wss:";auth:AuthKind[];modelRequired:boolean;fields:string[];capability:Readonly<PublicModelProtocolCapability>;}
const p=(id:string,label:string,vendor:Vendor,component:ModelComponent,scheme:"https:"|"wss:",auth:AuthKind[],modelRequired=true,fields:string[]=[]):Protocol=>{
  const capability=publicProtocolCapability(id);
  if(!capability||capability.vendor!==vendor||capability.component!==component)throw Error("public_catalog_capability_mismatch");
  return {id,label,vendor,component,scheme,auth,modelRequired,fields,capability};
};
export const publicModelCatalog={
  vendors:[{id:"qwen",label:"Qwen / 阿里云百炼"},{id:"tencent",label:"腾讯云 / 混元"},{id:"openai",label:"OpenAI"},{id:"google",label:"Google"}],
  protocols:[
    p("qwen_asr_realtime","Qwen ASR · Realtime WebSocket","qwen","asr","wss:",["api_key"]),
    p("qwen_asr_compatible","Qwen ASR · 兼容接口（非实时）","qwen","asr","https:",["api_key"]),
    p("qwen_chat","Qwen · Chat Completions","qwen","translation","https:",["api_key"]),
    p("qwen_tts_realtime","Qwen TTS · Realtime WebSocket","qwen","tts","wss:",["api_key"],true,["voice"]),
    p("tencent_asr_ws","腾讯语音识别 · WebSocket","tencent","asr","wss:",["tencent_secret"],true,["appId"]),
    p("tencent_hunyuan_chat","腾讯混元 · OpenAI兼容","tencent","translation","https:",["api_key"]),
    p("tencent_tts_ws","腾讯实时语音合成 · WebSocket","tencent","tts","wss:",["tencent_secret"],false,["appId","voice"]),
    p("openai_transcriptions","OpenAI · Audio Transcriptions","openai","asr","https:",["api_key"]),
    p("openai_realtime_asr","OpenAI · Realtime Transcription","openai","asr","wss:",["api_key"]),
    p("openai_chat","OpenAI · Chat Completions","openai","translation","https:",["api_key"]),
    p("openai_speech","OpenAI · Audio Speech","openai","tts","https:",["api_key"],true,["voice"]),
    p("google_speech_v2","Google Cloud · Speech-to-Text v2（gRPC）","google","asr","https:",["google_service_account","google_adc"],true,["projectId","location","recognizer","languageLocales"]),
    p("google_gemini","Google Gemini · API","google","translation","https:",["api_key"]),
    p("google_vertex_gemini","Google Vertex AI · Gemini","google","translation","https:",["google_service_account","google_adc"],true,["projectId","location"]),
    p("google_cloud_tts","Google Cloud · Text-to-Speech","google","tts","https:",["google_service_account","google_adc"],false,["projectId","voice"]),
  ],
  authLabels:{api_key:"API Key",tencent_secret:"SecretId + SecretKey",google_service_account:"服务账号 JSON",google_adc:"服务端 ADC"},
  credentialFields:{api_key:["apiKey"],tencent_secret:["secretId","secretKey"],google_service_account:["serviceAccountJson"],google_adc:[]} as Record<AuthKind,string[]>,
};
export class PublicConfigError extends Error{constructor(readonly code:string,readonly status=400){super(code);}}
export function emptyConfiguration(deploymentId:string):PublicModelConfiguration{
  return {schemaVersion:1,deploymentId,revision:0,updatedAt:"",components:Object.fromEntries(modelComponents.map(component=>{
    const protocol=publicModelCatalog.protocols.find(p=>p.vendor==="qwen"&&p.component===component)!;
    return [component,{enabled:false,vendor:"qwen",protocol:protocol.id,endpoint:"",modelId:"",authKind:"api_key",region:"",appId:"",projectId:"",location:"",recognizer:"",voice:"",timeoutMs:15000,maxTokens:512,sampleRate:protocol.capability.sampleRates[0]??16000}];
  })) as Record<ModelComponent,PublicModelProfile>,credentials:{asr:{},translation:{},tts:{}}};
}
const profileKeys=["enabled","vendor","protocol","endpoint","modelId","authKind","region","appId","projectId","location","recognizer","voice","timeoutMs","maxTokens","sampleRate"];
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
export function validateProfile(component:ModelComponent,value:unknown):PublicModelProfile{
  if(!object(value)||Object.keys(value).some(k=>!profileKeys.includes(k)&&k!=="languageLocales")||profileKeys.some(k=>!(k in value)))throw new PublicConfigError(`${component}:invalid_fields`);
  const v=value as unknown as PublicModelProfile;
  const protocol=publicModelCatalog.protocols.find(p=>p.id===v.protocol&&p.vendor===v.vendor&&p.component===component);
  if(!protocol||!protocol.auth.includes(v.authKind)||typeof v.enabled!=="boolean")throw new PublicConfigError(`${component}:invalid_protocol_or_auth`);
  if(v.languageLocales!==undefined&&(!object(v.languageLocales)||Object.keys(v.languageLocales).length>40||Object.entries(v.languageLocales).some(([k,s])=>
    !/^[a-z]{2,3}(?:-Hant)?$/.test(k)||k==="auto"||typeof s!=="string"||!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(s))))throw new PublicConfigError(`${component}:invalid_language_locales`);
  for(const key of ["endpoint","modelId","region","appId","projectId","location","recognizer","voice"] as const){
    if(typeof v[key]!=="string"||v[key].length>(key==="endpoint"?2048:240)||v[key].trim()!==v[key]||/[\u0000-\u001f\u007f]/u.test(v[key]))throw new PublicConfigError(`${component}:invalid_${key}`);
  }
  if(v.endpoint){let url:URL;try{url=new URL(v.endpoint);}catch{throw new PublicConfigError(`${component}:invalid_endpoint`);}
    if(url.protocol!==protocol.scheme||url.username||url.password||url.search||url.hash)throw new PublicConfigError(`${component}:endpoint_requires_${protocol.scheme.replace(":","")}_without_credentials_or_query`);}
  if(!Number.isSafeInteger(v.timeoutMs)||v.timeoutMs<250||v.timeoutMs>120000||!Number.isSafeInteger(v.maxTokens)||v.maxTokens<1||v.maxTokens>16384||![16000,24000].includes(v.sampleRate))throw new PublicConfigError(`${component}:invalid_limits`);
  if(v.enabled&&component!=="translation"&&!publicProtocolSampleRateSupported(v.protocol,v.sampleRate))throw new PublicConfigError(`${component}:unsupported_sample_rate`);
  return structuredClone(v);
}
export function mergeConfiguration(current:PublicModelConfiguration,body:unknown){
  if(!object(body)||Object.keys(body).some(k=>!["expectedRevision","components","credentials","clearCredentials"].includes(k))||
    !Number.isSafeInteger(body.expectedRevision)||!object(body.components)||Object.keys(body.components).length!==3||
    body.credentials!==undefined&&!object(body.credentials)||body.clearCredentials!==undefined&&!Array.isArray(body.clearCredentials))throw new PublicConfigError("invalid_config_request");
  if(body.expectedRevision!==current.revision)throw new PublicConfigError("config_revision_conflict",409);
  const updates=(body.credentials??{}) as Record<string,unknown>,clear=(body.clearCredentials??[]) as string[];
  if(Object.keys(updates).some(k=>!modelComponents.includes(k as ModelComponent))||clear.some(k=>!modelComponents.includes(k as ModelComponent)))throw new PublicConfigError("invalid_credential_scope");
  const next=structuredClone(current);
  for(const c of modelComponents){
    const v=validateProfile(c,body.components[c]),previous=current.components[c];
    const origin=(s:string)=>s?new URL(s).origin:"";
    const changed=v.vendor!==previous.vendor||v.authKind!==previous.authKind||origin(v.endpoint)!==origin(previous.endpoint);
    next.components[c]=v;
    const credentials:Credentials=changed||clear.includes(c)?{}:{...current.credentials[c]};
    const update=updates[c]??{};if(!object(update))throw new PublicConfigError(`${c}:invalid_credentials`);
    const allowed=publicModelCatalog.credentialFields[v.authKind];
    for(const [k,val]of Object.entries(update)){
      if(!allowed.includes(k)||typeof val!=="string"||val.length>65536)throw new PublicConfigError(`${c}:invalid_credentials`);
      if(!val)continue;
      if(k!=="serviceAccountJson"&&(/[\r\n]/.test(val)||val.trim()!==val))throw new PublicConfigError(`${c}:invalid_credentials`);
      if(k==="serviceAccountJson"){
        let a:Record<string,unknown>;try{a=JSON.parse(val);}catch{throw new PublicConfigError(`${c}:invalid_service_account`);}
        if(!object(a)||a.type!=="service_account"||typeof a.client_email!=="string"||typeof a.project_id!=="string"||typeof a.private_key!=="string"||!a.private_key.includes("BEGIN PRIVATE KEY"))throw new PublicConfigError(`${c}:invalid_service_account`);
      }
      credentials[k as keyof Credentials]=val;
    }
    next.credentials[c]=credentials;
  }
  next.revision++;next.updatedAt=new Date().toISOString();return next;
}
export function publicConfiguration(config:PublicModelConfiguration){
  const status=Object.fromEntries(modelComponents.map(c=>{
    const v=config.components[c],p=publicModelCatalog.protocols.find(p=>p.id===v.protocol)!;
    const missing:string[]=[];
    if(v.enabled){if(!v.endpoint)missing.push("endpoint");if(p.modelRequired&&!v.modelId)missing.push("modelId");
      if(c!=="translation"&&!publicProtocolSampleRateSupported(v.protocol,v.sampleRate))missing.push("sampleRate");
      for(const f of p.fields)if(!v[f as keyof PublicModelProfile]||f==="languageLocales"&&!Object.keys(v.languageLocales??{}).length)missing.push(f);
      for(const key of publicModelCatalog.credentialFields[v.authKind])if(!config.credentials[c][key as keyof Credentials])missing.push(key);}
    return [c,{state:!v.enabled?"disabled":missing.length?"incomplete":"configured_not_verified",missing,
      credentialsPresent:Object.fromEntries(publicModelCatalog.credentialFields[v.authKind].map(k=>[k,Boolean(config.credentials[c][k as keyof Credentials])]))}];
  }));
  return {schemaVersion:1,deploymentId:config.deploymentId,revision:config.revision,updatedAt:config.updatedAt,
    components:structuredClone(config.components),status,runtimeActivated:false,saveTriggersModelCalls:false};
}
