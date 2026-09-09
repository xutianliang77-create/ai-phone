import {modelComponents,PublicConfigError,type ModelComponent} from "./public-model-config.js";
import {encryptedModelConfigStore} from "./encrypted-model-config-store.js";
export interface PrivateModelProfile {enabled:boolean;vendor:"self_hosted"|"lmstudio"|"hymt2_self_hosted";protocol:string;
  authKind:"api_key"|"none";endpoint:string;healthUrl:string;flushEndpoint:string;streamEndpoint:string;modelId:string;voice:string;
  timeoutMs:number;maxTokens:number;sampleRate:16000|24000;}
interface PrivateConfiguration {schemaVersion:1;deploymentId:string;revision:number;updatedAt:string;
  components:Record<ModelComponent,PrivateModelProfile>;credentials:Record<ModelComponent,{apiKey?:string}>;}
export const privateModelCatalog={
  vendors:[{id:"self_hosted",label:"自托管 HTTP 服务"},{id:"lmstudio",label:"LM Studio"},{id:"hymt2_self_hosted",label:"Hy-MT2 私有服务"}],vendorLabel:"私有模型服务",
  authLabels:{api_key:"API Key / Bearer Token",none:"无认证（仅配置意图）"},credentialFields:{api_key:["apiKey"],none:[]},
  protocols:[
    {id:"private_asr_http",label:"原无界 ASR HTTP",vendor:"self_hosted",component:"asr",modelRequired:false,fields:["flushEndpoint"]},
    {id:"private_mt_http",label:"私有 Chat Completions",vendor:"self_hosted",component:"translation",modelRequired:true,fields:[]},
    {id:"private_lmstudio",label:"LM Studio · Chat Completions",vendor:"lmstudio",component:"translation",modelRequired:true,fields:[]},
    {id:"private_hymt2",label:"Hy-MT2 · Chat Completions",vendor:"hymt2_self_hosted",component:"translation",modelRequired:true,fields:[]},
    {id:"private_tts_http",label:"原无界 TTS HTTP / 流式",vendor:"self_hosted",component:"tts",modelRequired:false,fields:["streamEndpoint","voice"]},
  ].map(p=>({...p,scheme:"http:",auth:["api_key","none"],endpointPlaceholder:p.component==="asr"?"http://内网主机:端口/asr/transcribe":p.component==="tts"?"http://内网主机:端口/tts/synthesize":"http://内网主机:端口/v1",
    modelPlaceholder:p.modelRequired?"填写私有服务实际加载的翻译模型 ID":"可选：实际模型由私有服务部署决定"})),
  editorFields:[["endpoint","服务地址 / 翻译 Base URL","wide"],["modelId","模型标识（翻译必填）","wide"],["healthUrl","健康检查 URL（可选）","wide"],
    ["flushEndpoint","ASR flush URL（可用 :sessionId）","wide"],["streamEndpoint","TTS 流式 URL（可选）","wide"],["voice","音色 ID（可选）"],
    ["timeoutMs","请求超时（毫秒）"],["maxTokens","翻译最大输出 Tokens"],["sampleRate","PCM 采样率"]],
};
export function emptyPrivateConfiguration(deploymentId:string):PrivateConfiguration{
  return {schemaVersion:1,deploymentId,revision:0,updatedAt:"",components:Object.fromEntries(modelComponents.map(c=>[c,{enabled:false,vendor:"self_hosted",
    protocol:privateModelCatalog.protocols.find(p=>p.component===c)!.id,authKind:"api_key",endpoint:"",modelId:"",healthUrl:"",flushEndpoint:"",streamEndpoint:"",voice:"",timeoutMs:15000,maxTokens:512,sampleRate:16000}])) as Record<ModelComponent,PrivateModelProfile>,credentials:{asr:{},translation:{},tts:{}}};
}
const keys=Object.keys(emptyPrivateConfiguration("schema").components.asr);
function obj(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
function origin(s:string){return s?new URL(s.replace(":sessionId","session")).origin:"";}
function profile(c:ModelComponent,value:unknown):PrivateModelProfile{
  if(!obj(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value)))throw new PublicConfigError(`${c}:invalid_fields`);
  const v=value as unknown as PrivateModelProfile,p=privateModelCatalog.protocols.find(p=>p.component===c&&p.vendor===v.vendor&&p.id===v.protocol);
  if(!p||!["api_key","none"].includes(v.authKind)||typeof v.enabled!=="boolean")throw new PublicConfigError(`${c}:invalid_protocol_or_auth`);
  for(const key of ["endpoint","healthUrl","flushEndpoint","streamEndpoint","modelId","voice"] as const){
    if(typeof v[key]!=="string"||v[key].trim()!==v[key]||v[key].length>(key.endsWith("Url")||key.endsWith("Endpoint")||key==="endpoint"?2048:240)||/[\u0000-\u001f\u007f]/u.test(v[key]))throw new PublicConfigError(`${c}:invalid_${key}`);
  }
  for(const key of ["endpoint","healthUrl","flushEndpoint","streamEndpoint"] as const){if(!v[key])continue;
    let u:URL;try{u=new URL(v[key].replace(":sessionId","session"));}catch{throw new PublicConfigError(`${c}:invalid_${key}`);}
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new PublicConfigError(`${c}:invalid_${key}`);
    if(key!=="endpoint"&&v.endpoint&&u.origin!==origin(v.endpoint))throw new PublicConfigError(`${c}:auxiliary_origin_mismatch`);
  }
  if(c!=="asr"&&v.flushEndpoint||c!=="tts"&&v.streamEndpoint)throw new PublicConfigError(`${c}:invalid_auxiliary_endpoint`);
  if(!Number.isSafeInteger(v.timeoutMs)||v.timeoutMs<250||v.timeoutMs>120000||!Number.isSafeInteger(v.maxTokens)||v.maxTokens<1||v.maxTokens>16384||![16000,24000].includes(v.sampleRate))throw new PublicConfigError(`${c}:invalid_limits`);
  return structuredClone(v);
}
function merge(current:PrivateConfiguration,body:unknown){
  if(!obj(body)||Object.keys(body).some(k=>!["expectedRevision","components","credentials","clearCredentials"].includes(k))||!Number.isSafeInteger(body.expectedRevision)||
    !obj(body.components)||Object.keys(body.components).length!==3||body.credentials!==undefined&&!obj(body.credentials)||body.clearCredentials!==undefined&&!Array.isArray(body.clearCredentials))throw new PublicConfigError("invalid_config_request");
  if(body.expectedRevision!==current.revision)throw new PublicConfigError("config_revision_conflict",409);
  const updates=(body.credentials??{}) as Record<string,unknown>,clear=(body.clearCredentials??[]) as string[];
  if(Object.keys(updates).some(k=>!modelComponents.includes(k as ModelComponent))||clear.some(k=>!modelComponents.includes(k as ModelComponent)))throw new PublicConfigError("invalid_credential_scope");
  const next=structuredClone(current);
  for(const c of modelComponents){const v=profile(c,body.components[c]),old=current.components[c];next.components[c]=v;
    const retained=v.vendor===old.vendor&&v.authKind===old.authKind&&origin(v.endpoint)===origin(old.endpoint)&&!clear.includes(c);
    const credentials=retained?{...current.credentials[c]}:{};const update=updates[c]??{};
    if(!obj(update)||Object.keys(update).some(k=>k!=="apiKey"||v.authKind!=="api_key"))throw new PublicConfigError(`${c}:invalid_credentials`);
    if(update.apiKey!==undefined){if(typeof update.apiKey!=="string"||update.apiKey.length>65536||update.apiKey.trim()!==update.apiKey||/[\r\n]/.test(update.apiKey))throw new PublicConfigError(`${c}:invalid_credentials`);if(update.apiKey)credentials.apiKey=update.apiKey;}
    next.credentials[c]=credentials;
  }
  next.revision++;next.updatedAt=new Date().toISOString();return next;
}
export function privateConfiguration(config:PrivateConfiguration){
  const status=Object.fromEntries(modelComponents.map(c=>{const v=config.components[c],p=privateModelCatalog.protocols.find(p=>p.id===v.protocol)!,missing:string[]=[];
    if(v.enabled){if(!v.endpoint)missing.push("endpoint");if(p.modelRequired&&!v.modelId)missing.push("modelId");if(v.authKind==="api_key"&&!config.credentials[c].apiKey)missing.push("apiKey");}
    return [c,{state:!v.enabled?"disabled":missing.length?"incomplete":"configured_not_verified",missing,credentialsPresent:v.authKind==="api_key"?{apiKey:Boolean(config.credentials[c].apiKey)}:{}}];}));
  return {schemaVersion:1,deploymentId:config.deploymentId,revision:config.revision,updatedAt:config.updatedAt,components:structuredClone(config.components),status,runtimeActivated:false,saveTriggersModelCalls:false,existingPrivateRuntimeModified:false};
}
const store=encryptedModelConfigStore({kind:"private",deploymentEnv:"PRIVATE_MODEL_CONFIG_DEPLOYMENT_ID",empty:emptyPrivateConfiguration,merge,present:privateConfiguration});
export const readPrivateModelConfiguration=store.read;
export const savePrivateModelConfiguration=store.save;
