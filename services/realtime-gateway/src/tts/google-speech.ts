import type {PublicModelAttemptEvent} from "@translation/contracts";
import {PublicSpeechError,type PublicSpeechOptions,type PublicSpeechCredentials} from "./public-speech.js";
import {abortable} from "../providers/abortable.js";
import {publicRequestMetadata} from "../providers/lmstudio/lmstudio-public-protocol.js";
const fail=(code:string,outcome:"not_sent"|"rejected"|"uncertain"="not_sent"):never=>{throw new PublicSpeechError(code,outcome);};

export function googleSpeechConfiguration(options:PublicSpeechOptions){
  const url=new URL(options.endpoint),path=url.pathname.replace(/\/$/,"");
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||
    !["","/v1","/v1/text:synthesize"].includes(path)||!options.projectId||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(options.projectId))return fail("google_tts_configuration");
  // Named stock voices encode a BCP-47 language/region prefix. No silent choice
  // of region, gender, custom voice or default en-US is permitted.
  const match=/^([a-z]{2,3})-([A-Z]{2}|[0-9]{3})-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.exec(options.voice);
  if(!match)return fail("google_tts_voice_locale_required");
  const language=match[1]==="cmn"?"zh":match[1];
  if(options.targetLanguage!==language&&!(options.targetLanguage==="zh-Hant"&&language==="zh"&&match[2]==="TW"))return fail("google_tts_language_scope");
  url.pathname="/v1/text:synthesize";
  return {url:url.toString(),languageCode:`${match[1]}-${match[2]}`};
}
export function googleSpeechCredentials(options:PublicSpeechOptions,credentials:PublicSpeechCredentials){
  if(typeof credentials.accessToken!=="string"||!credentials.accessToken||credentials.accessToken.trim()!==credentials.accessToken||/[\r\n]/.test(credentials.accessToken)||
    !Number.isFinite(credentials.accessTokenExpiresAt)||credentials.accessTokenExpiresAt!<=Date.now()+options.timeoutMs)return fail("google_tts_token_required");
  if(credentials.quotaProjectId!==undefined&&credentials.quotaProjectId!==options.projectId)return fail("google_tts_quota_project_mismatch");
  return credentials.accessToken;
}

/** Strict response boundary. Original voice-reference parsing was inspected, but
 * its stereo/quality-analysis rules cannot qualify public mono playback payloads. */
export function googleLinear16Pcm(wav:Buffer,rate:number){
  const invalid=()=>fail("google_tts_wav_invalid","uncertain");
  if(wav.length<44||wav.length>rate*2*120+65536||wav.toString("ascii",0,4)!=="RIFF"||
    wav.toString("ascii",8,12)!=="WAVE"||wav.readUInt32LE(4)!==wav.length-8)return invalid();
  let offset=12,format=false,pcm:Buffer|undefined,chunks=0;
  while(offset<wav.length){
    if(++chunks>128||offset+8>wav.length)return invalid();
    const id=wav.toString("ascii",offset,offset+4),size=wav.readUInt32LE(offset+4),start=offset+8,end=start+size;
    if(end+(size%2)>wav.length)return invalid();
    if(id==="fmt "){
      if(format||![16,18].includes(size)||size===18&&wav.readUInt16LE(start+16)!==0||wav.readUInt16LE(start)!==1||
        wav.readUInt16LE(start+2)!==1||wav.readUInt32LE(start+4)!==rate||wav.readUInt32LE(start+8)!==rate*2||
        wav.readUInt16LE(start+12)!==2||wav.readUInt16LE(start+14)!==16)return invalid();format=true;
    }
    if(id==="data"){if(pcm||!size||size%2||size>rate*2*120)return invalid();pcm=wav.subarray(start,end);}
    offset=end+(size%2);
  }
  if(!format||!pcm)return invalid();return pcm;
}

/** Cloud text:synthesize is a complete JSON/WAV response, NOT model-side streaming.
 * The original shared PCM framer sends the decoded samples to the phone afterward. */
export async function* googleSpeechPcm(options:PublicSpeechOptions,text:string,credentials:PublicSpeechCredentials,signal:AbortSignal,
  markSent:()=>void,metadata:NonNullable<PublicModelAttemptEvent["metadata"]>):AsyncIterable<Buffer>{
  const configuration=googleSpeechConfiguration(options),token=googleSpeechCredentials(options,credentials),rate=options.sampleRate??24000;
  if(Buffer.byteLength(text)>5000)return fail("google_tts_text_too_large");
  const check=()=>{if(signal.aborted)return fail("google_tts_cancelled","uncertain");};check();markSent();
  const response=await abortable((options.fetchFn??fetch)(configuration.url,{method:"POST",redirect:"error",signal,
    headers:{"content-type":"application/json",authorization:`Bearer ${token}`,"x-goog-user-project":options.projectId!},
    body:JSON.stringify({input:{text},voice:{languageCode:configuration.languageCode,name:options.voice},audioConfig:{audioEncoding:"LINEAR16",sampleRateHertz:rate}})}),signal);
  Object.assign(metadata,publicRequestMetadata(response.headers.get("x-request-id")));check();
  if(!response.ok){void response.body?.cancel().catch(()=>{});return fail("google_tts_http_failed",[400,401,403,404,422,429].includes(response.status)?"rejected":"uncertain");}
  if(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"||!response.body){void response.body?.cancel().catch(()=>{});return fail("google_tts_response_format","uncertain");}
  const maxJsonBytes=Math.ceil((rate*2*120+65536)/3)*4+1024;
  const length=response.headers.get("content-length");
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxJsonBytes)){void response.body.cancel().catch(()=>{});return fail("google_tts_response_size","uncertain");}
  const reader=response.body.getReader(),buffers:Uint8Array[]=[];let bytes=0;
  try{while(true){const next=await abortable(reader.read(),signal);check();if(next.done)break;bytes+=next.value.byteLength;
    if(bytes>maxJsonBytes)return fail("google_tts_response_size","uncertain");buffers.push(next.value);}
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  let data:any;try{data=JSON.parse(Buffer.concat(buffers).toString());}catch{return fail("google_tts_response_json","uncertain");}
  if(!data||Array.isArray(data)||typeof data.audioContent!=="string"||!data.audioContent)return fail("google_tts_audio_missing","uncertain");
  const wav=Buffer.from(data.audioContent,"base64");if(wav.toString("base64")!==data.audioContent)return fail("google_tts_audio_encoding","uncertain");
  const pcm=googleLinear16Pcm(wav,rate);check();yield pcm;
}
