import {Client,credentials,Metadata} from "@grpc/grpc-js";
import {protos} from "@google-cloud/speech";
import type {PublicModelAttemptEvent} from "@translation/contracts";
import type {StreamingAsrOptions} from "./openai-streaming-asr-client.js";
import {PublicAsrError} from "./public-asr-completed-audio.js";
import {abortable} from "../providers/abortable.js";
export type GoogleAsrRequest=protos.google.cloud.speech.v2.IStreamingRecognizeRequest;
export type GoogleAsrResponse=protos.google.cloud.speech.v2.IStreamingRecognizeResponse;
export interface GoogleStreamInput {target:string;headers:Record<string,string>;deadline:Date;}
export interface GoogleAsrDuplex {
  on(event:string,listener:(...args:any[])=>void):unknown;
  write(request:GoogleAsrRequest,callback:(error?:Error|null)=>void):boolean;
  end():unknown;
  cancel():void;
  readonly writableLength:number;
}
export type GoogleAsrStreamFactory=(input:GoogleStreamInput)=>{stream:GoogleAsrDuplex;close:()=>void};
const rpcPath="/google.cloud.speech.v2.Speech/StreamingRecognize";
export function encodeGoogleAsrRequest(value:GoogleAsrRequest){const type=protos.google.cloud.speech.v2.StreamingRecognizeRequest;if(type.verify(value))throw Error("google_asr_request_invalid");return Buffer.from(type.encode(value).finish());}
export function decodeGoogleAsrResponse(value:Buffer){return protos.google.cloud.speech.v2.StreamingRecognizeResponse.decode(value);}
/** Official protobuf definitions + gRPC transport, not a REST approximation.
 * Explicit metadata and TLS only: no GoogleAuth/ambient ADC lookup, GAX retry,
 * service discovery, custom server options or credential refresh in this layer. */
export const createGoogleAsrStream:GoogleAsrStreamFactory=input=>{
  const client=new Client(input.target,credentials.createSsl(),{"grpc.enable_retries":0,"grpc.max_receive_message_length":262144,"grpc.max_send_message_length":262144});
  const metadata=new Metadata();for(const [key,value]of Object.entries(input.headers))metadata.set(key,value);
  try{return {stream:client.makeBidiStreamRequest(rpcPath,encodeGoogleAsrRequest,decodeGoogleAsrResponse,metadata,{deadline:input.deadline}),close:()=>client.close()};}
  catch(error){client.close();throw error;}
};
const segment=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,240}$/.test(v);
export function googleAsrConfiguration(options:StreamingAsrOptions){
  const url=new URL(options.endpoint),locale=options.languageLocales?.[options.language];
  const base=typeof locale==="string"?locale.split("-")[0]:"",canonical=base==="cmn"?"zh":base==="fil"?"tl":base;
  const languageMatches=canonical===options.language||options.language==="zh-Hant"&&canonical==="zh"&&/-(Hant|TW|HK)(-|$)/.test(locale??"");
  if(!segment(options.projectId)||!segment(options.location)||!segment(options.recognizer)||!segment(options.model)||options.model==="latest_short"||
    !locale||!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(locale)||!languageMatches||
    ![16000,24000].includes(options.sampleRate??0)||url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.port||
    !["/","/v2"].includes(url.pathname)||url.hostname!==(options.location==="global"?"speech.googleapis.com":`${options.location}-speech.googleapis.com`)){
    throw new PublicAsrError("google_asr_configuration","not_sent");
  }
  const recognizer=`projects/${options.projectId}/locations/${options.location}/recognizers/${options.recognizer}`;
  const request:GoogleAsrRequest={recognizer,streamingConfig:{configMask:{paths:["*"]},
    config:{model:options.model,languageCodes:[locale],explicitDecodingConfig:{encoding:protos.google.cloud.speech.v2.ExplicitDecodingConfig.AudioEncoding.LINEAR16,
      sampleRateHertz:options.sampleRate,audioChannelCount:1},features:{maxAlternatives:1,enableAutomaticPunctuation:true,profanityFilter:false}},
    streamingFeatures:{interimResults:true,enableVoiceActivityEvents:false}}};
  return {target:`${url.hostname}:443`,locale,recognizer,request};
}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});void promise.catch(()=>{});return {promise,resolve,reject};}
function seconds(value:protos.google.protobuf.IDuration|undefined|null){if(!value)return undefined;const s=Number(value.seconds??0),n=value.nanos??0;
  if(!Number.isSafeInteger(s)||s<0||s>3600||!Number.isSafeInteger(n)||n<0||n>=1e9)throw Error("duration");return s+n/1e9;}

/** One application endpoint per bidirectional RPC. The original shared lifecycle
 * still owns leases, accepted audio intervals, attempts, cancel and next turn. */
export class GoogleAsrWire {
  private transport?:ReturnType<GoogleAsrStreamFactory>;private readonly done=deferred<{text:string;metadata:NonNullable<PublicModelAttemptEvent["metadata"]>}>();
  private failure?:PublicAsrError;private ended=false;private readEnded=false;private statusOk=false;private finished=false;private sent=false;
  private nextSendAt=0;private responses=0;private settled="";private interim="";private finalOffset=0;private metadata:NonNullable<PublicModelAttemptEvent["metadata"]>={};
  constructor(private readonly options:StreamingAsrOptions,private readonly signal:AbortSignal,private readonly partial:(text:string)=>void,private readonly onFailure:()=>void){}
  private cancel=()=>this.fail("google_asr_cancelled");
  async open(value:{accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string}){
    const config=googleAsrConfiguration(this.options),deadline=Date.now()+30000+this.options.timeoutMs;
    if(!value.accessToken||value.accessToken.trim()!==value.accessToken||/[\r\n]/.test(value.accessToken)||!Number.isFinite(value.accessTokenExpiresAt)||value.accessTokenExpiresAt!<=deadline||
      value.quotaProjectId!==undefined&&value.quotaProjectId!==this.options.projectId)throw new PublicAsrError("google_asr_token_scope","not_sent");
    this.signal.addEventListener("abort",this.cancel,{once:true});this.check();
    this.transport=(this.options.googleStreamFactory??createGoogleAsrStream)({target:config.target,deadline:new Date(deadline),headers:{authorization:`Bearer ${value.accessToken}`,
      "x-goog-user-project":this.options.projectId!,"x-goog-request-params":`recognizer=${encodeURIComponent(config.recognizer)}`}});
    const stream=this.transport.stream;
    stream.on("error",()=>this.fail("google_asr_transport"));
    stream.on("status",status=>{if(status.code!==0)this.fail("google_asr_status");else{this.statusOk=true;this.complete();}});
    stream.on("end",()=>{if(!this.ended)this.fail("google_asr_early_end");else{this.readEnded=true;this.complete();}});
    stream.on("close",()=>{if(!this.finished&&!this.failure)this.fail("google_asr_incomplete");});
    stream.on("data",(response:GoogleAsrResponse)=>{if(this.failure)return;try{this.receive(response,config.locale);}catch{this.fail("google_asr_protocol");}});
    await this.write(config.request);this.check();
  }
  async append(pcm:Buffer,markSent:()=>void){
    if(this.ended)throw new PublicAsrError("google_asr_turn_closed","not_sent");const rate=this.options.sampleRate!,chunkBytes=rate*2/25;
    for(let offset=0;offset<pcm.length;offset+=chunkBytes){this.check();const delay=Math.max(0,this.nextSendAt-performance.now());
      if(delay>0){let timer:ReturnType<typeof setTimeout>|undefined;try{await abortable(new Promise<void>(r=>timer=setTimeout(r,delay)),this.signal);}finally{clearTimeout(timer);}}
      this.check();const chunk=pcm.subarray(offset,offset+chunkBytes);markSent();this.sent=true;await this.write({audio:chunk});this.nextSendAt=performance.now()+chunk.length/(rate*2)*1000;
    }
  }
  async finish(){this.check();if(!this.ended){this.ended=true;this.transport!.stream.end();}return abortable(this.done.promise,this.signal);}
  close(){this.signal.removeEventListener("abort",this.cancel);this.finished=true;this.transport?.stream.cancel();this.transport?.close();}
  private check(){if(this.signal.aborted)this.fail("google_asr_cancelled");if(this.failure)throw this.failure;}
  private async write(request:GoogleAsrRequest){this.check();if(!this.transport||this.transport.stream.writableLength>32)throw Error("backpressure");
    await abortable(new Promise<void>((resolve,reject)=>this.transport!.stream.write(request,(e?:Error|null)=>e?reject(Error("write")):resolve())),this.signal);}
  private complete(){if(this.failure||this.finished||!this.readEnded||!this.statusOk)return;if(!this.ended||this.interim.trim())return this.fail("google_asr_missing_final");
    this.finished=true;this.done.resolve({text:this.settled,metadata:this.metadata});}
  private fail(code:string){if(this.failure||this.finished)return;this.failure=new PublicAsrError(code,this.sent?"uncertain":"not_sent");this.done.reject(this.failure);this.transport?.stream.cancel();this.transport?.close();this.onFailure();}
  private receive(value:GoogleAsrResponse,locale:string){
    if(++this.responses>4096||!value||this.finished||(value.speechEventType??0)!==0||(value as any).error)throw Error();
    const m=value.metadata;if(m){if(m.requestId){if(!segment(m.requestId)||this.metadata.requestId&&this.metadata.requestId!==m.requestId)throw Error();this.metadata.requestId=m.requestId;}
      const billed=seconds(m.totalBilledDuration);if(billed!==undefined){if(billed<(this.metadata.usage?.audioSeconds??0))throw Error();this.metadata.usage={audioSeconds:billed};}}
    if(!value.results?.length)return;if(!this.sent||value.results.length>32)throw Error();let draft="",offset=this.finalOffset,foundInterim=false,finals=0;
    for(const r of value.results){const text=r.alternatives?.[0]?.transcript,end=seconds(r.resultEndOffset);
      if(typeof text!=="string"||text.length>16000||r.alternatives!.length>1||r.languageCode?.toLowerCase()!==locale.toLowerCase()||
        ![0,1].includes(r.channelTag??0)||end===undefined||end<offset||end>30||r.isFinal&&foundInterim)throw Error();
      offset=end;
      if(r.isFinal){if(++finals>1||end<=this.finalOffset)throw Error();this.settled+=text;this.finalOffset=end;}
      else{foundInterim=true;draft+=text;}
    }
    if(this.settled.length+draft.length>16000)throw Error();this.interim=draft;this.partial(this.settled+draft);
  }
}
