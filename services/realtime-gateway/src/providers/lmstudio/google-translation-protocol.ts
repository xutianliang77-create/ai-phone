import type {LmStudioClientOptions} from "./lmstudio-client.js";
import {parsePublicTranslation,PublicTranslationError} from "./lmstudio-public-protocol.js";

/** Wire-only adapter; shared client owns transport, cancellation and attempt journal. */
export function googleTranslationRequest(options:LmStudioClientOptions,prompt:string,text:string){
  const google=options.google;
  const invalid=()=>{throw new PublicTranslationError("public_google_configuration","not_sent");};
  if(!google||!["gemini","vertex"].includes(google.protocol)||Object.keys(options.extraBody??{}).length)return invalid();
  const url=new URL(options.baseUrl),base=url.pathname.replace(/\/$/,"");
  if(!/^\/(v1|v1beta|v1beta1)$/.test(base)&&base!=="")return invalid();
  const segment=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9._-]{1,240}$/.test(v)&&v!=="."&&v!=="..";
  const model=options.model.replace(/^models\//,"");if(!segment(model))return invalid();
  const headers:Record<string,string>={"content-type":"application/json"};
  if(google.protocol==="vertex"){
    if(!segment(google.projectId)||!segment(google.location)||!google.accessToken)return invalid();
    url.pathname=`${base||"/v1"}/projects/${google.projectId}/locations/${google.location}/publishers/google/models/${model}:generateContent`;
    headers.authorization=`Bearer ${google.accessToken}`;
    if(google.quotaProjectId!==undefined){if(!segment(google.quotaProjectId))return invalid();headers["x-goog-user-project"]=google.quotaProjectId;}
  }else{
    url.pathname=`${base||"/v1beta"}/models/${model}:generateContent`;
    headers["x-goog-api-key"]=options.apiKey!;
  }
  return {url:url.toString(),headers,body:{systemInstruction:{parts:[{text:prompt}]},contents:[{role:"user",parts:[{text}]}],
    generationConfig:{temperature:0,maxOutputTokens:options.maxTokens??512,candidateCount:1,responseMimeType:"text/plain"}}};
}

export function parseGoogleTranslation(value:unknown,headerId:string|null){
  const fail=()=>{throw new PublicTranslationError("public_google_invalid_response","uncertain");};
  if(!value||typeof value!=="object"||Array.isArray(value))return fail();
  const b=value as Record<string,any>;
  let usage:Record<string,unknown>|undefined;
  if(b.usageMetadata!==undefined){
    if(!b.usageMetadata||typeof b.usageMetadata!=="object"||Array.isArray(b.usageMetadata))return fail();
    usage={};
    for(const [wire,key]of [["promptTokenCount","prompt_tokens"],["candidatesTokenCount","completion_tokens"],["totalTokenCount","total_tokens"],
      ["thoughtsTokenCount","thought_tokens"],["cachedContentTokenCount","cached_prompt_tokens"]]){
      const n=b.usageMetadata[wire];if(n===undefined)continue;
      if(!Number.isSafeInteger(n)||n<0)throw new PublicTranslationError("public_translation_invalid_usage","uncertain");
      usage[key]=n;
    }
  }
  const candidate=Array.isArray(b.candidates)&&b.candidates.length===1?b.candidates[0]:undefined;
  let text="",valid=!!candidate&&candidate.finishReason==="STOP"&&!b.promptFeedback?.blockReason;
  const parts=candidate?.content?.parts;
  if(!Array.isArray(parts)||!parts.length||candidate?.content?.role!=="model")valid=false;
  else for(const part of parts){
    if(!part||typeof part!=="object"||Array.isArray(part)||Object.keys(part).some(k=>!["text","thought","thoughtSignature"].includes(k))||
      typeof part.text!=="string"||part.thought!==undefined&&typeof part.thought!=="boolean"){valid=false;continue;}
    if(part.thought!==true)text+=part.text;
  }
  // Reuse the strict final-text/metadata parser; never expose thought parts,
  // tool calls, block explanations or supplier error bodies as translations.
  return parsePublicTranslation({id:b.responseId,model:b.modelVersion,usage,
    choices:[{finish_reason:valid?"stop":"incomplete",message:{content:text}}]},headerId);
}
