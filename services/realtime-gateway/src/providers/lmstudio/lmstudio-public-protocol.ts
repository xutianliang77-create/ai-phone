import {isTranslationLanguage} from "@translation/contracts";
import {abortable} from "../abortable.js";
export {abortable} from "../abortable.js";
import type {LmStudioClientOptions} from "./lmstudio-client.js";
export interface PublicTranslationMetadata {
  requestId?:string;reportedModel?:string;
  usage?:{promptTokens?:number;completionTokens?:number;totalTokens?:number;thoughtTokens?:number;cachedPromptTokens?:number};
}
export class PublicTranslationError extends Error {
  constructor(readonly code:string,readonly outcome:"not_sent"|"rejected"|"uncertain",
    readonly status?:number,readonly metadata?:PublicTranslationMetadata){super(code);this.name="PublicTranslationError";}
}
export function validatePublicTranslation(options:LmStudioClientOptions,input:{text:string;sourceLanguage:string;targetLanguage:string}){
  let url:URL;try{url=new URL(options.baseUrl);}catch{throw new PublicTranslationError("public_translation_configuration","not_sent");}
  const credential=options.transportProfile==="public_google"&&options.google?.protocol==="vertex"?options.google.accessToken:options.apiKey;
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||typeof credential!=="string"||!credential.trim()||credential.trim()!==credential||/[\r\n]/.test(credential)||
    !options.model.trim()||options.model.length>240||!Number.isFinite(options.timeoutMs)||options.timeoutMs<=0||
    options.timeoutMs>120000||!Number.isSafeInteger(options.maxTokens??512)||(options.maxTokens??512)<1||
    Object.keys(options.extraBody??{}).some(k=>!["enable_thinking"].includes(k))||
    (options.extraBody?.enable_thinking!==undefined&&options.extraBody.enable_thinking!==false)) {
    throw new PublicTranslationError("public_translation_configuration","not_sent");
  }
  if(!isTranslationLanguage(input.sourceLanguage)||!isTranslationLanguage(input.targetLanguage)||
    input.sourceLanguage===input.targetLanguage||!input.text.trim()||Buffer.byteLength(input.text)>65536){
    throw new PublicTranslationError("public_translation_invalid_input","not_sent");
  }
}
export async function readPublicJson(response:Response,signal:AbortSignal):Promise<unknown>{
  if(!response.body)throw new PublicTranslationError("public_translation_invalid_response","uncertain");
  const reader=response.body.getReader(),chunks:Buffer[]=[];let bytes=0;
  try{
    while(true){const chunk=await abortable(reader.read(),signal);if(chunk.done)break;
      bytes+=chunk.value.byteLength;if(bytes>262144)throw new PublicTranslationError("public_translation_response_too_large","uncertain");
      chunks.push(Buffer.from(chunk.value));}
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function key(value:unknown){return typeof value==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(value)?value:undefined;}
export function publicRequestMetadata(headerId:string|null):PublicTranslationMetadata {
  const requestId=key(headerId);return requestId?{requestId}:{};
}
export function parsePublicTranslation(value:unknown,headerId:string|null){
  const b=value as {id?:unknown;model?:unknown;usage?:Record<string,unknown>;choices?:Array<{finish_reason?:unknown;message?:{content?:unknown}}>};
  if(!b||typeof b!=="object"||Array.isArray(b))throw new PublicTranslationError("public_translation_invalid_response","uncertain");
  const metadata:PublicTranslationMetadata={};
  const id=key(headerId)||key(b.id),model=key(b.model);if(id)metadata.requestId=id;if(model)metadata.reportedModel=model;
  if(b.usage!==undefined){
    if(!b.usage||typeof b.usage!=="object"||Array.isArray(b.usage))throw new PublicTranslationError("public_translation_invalid_usage","uncertain");
    const usage:NonNullable<PublicTranslationMetadata["usage"]>={};
    for(const [wire,field] of [["prompt_tokens","promptTokens"],["completion_tokens","completionTokens"],["total_tokens","totalTokens"],["thought_tokens","thoughtTokens"],["cached_prompt_tokens","cachedPromptTokens"]] as const){
      const n=b.usage[wire];if(n===undefined)continue;
      if(!Number.isSafeInteger(n)||Number(n)<0)throw new PublicTranslationError("public_translation_invalid_usage","uncertain");
      usage[field]=Number(n);
    }
    if(Object.keys(usage).length)metadata.usage=usage;
  }
  const choice=b.choices?.[0];
  if(!Array.isArray(b.choices)||b.choices.length!==1||choice?.finish_reason!=="stop"||typeof choice.message?.content!=="string"){
    throw new PublicTranslationError("public_translation_incomplete","uncertain",undefined,metadata);
  }
  const text=choice.message.content.replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
  if(!text||/<\/?think\b/i.test(text))throw new PublicTranslationError("public_translation_empty","uncertain",undefined,metadata);
  return {text,metadata};
}
