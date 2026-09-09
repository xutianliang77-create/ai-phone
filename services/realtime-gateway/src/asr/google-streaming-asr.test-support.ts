import {Duplex} from "node:stream";
import {protos} from "@google-cloud/speech";
import type {GoogleAsrRequest,GoogleAsrResponse,GoogleAsrStreamFactory} from "./google-streaming-asr.js";
import {encodeGoogleAsrRequest,decodeGoogleAsrResponse} from "./google-streaming-asr.js";
/** Uses the installed official protobuf codecs, but no actual network or auth. */
export class SyntheticGoogleAsrStream extends Duplex {
  requests:GoogleAsrRequest[]=[];configuration?:GoogleAsrRequest;audioBytes=0;cancelled=false;clientClosed=false;
  transcript="Hello world.";language="en-US";statusCode=0;autoFinish=true;
  onRequest?:(request:GoogleAsrRequest)=>void;
  constructor(){super({objectMode:true});}
  _read(){}
  _write(request:GoogleAsrRequest,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){
    const decoded=protos.google.cloud.speech.v2.StreamingRecognizeRequest.decode(encodeGoogleAsrRequest(request));this.requests.push(decoded);
    if(decoded.streamingConfig){this.configuration=decoded;this.language=decoded.streamingConfig.config!.languageCodes![0];}
    else{this.audioBytes+=(decoded.audio as Uint8Array).length;this.respond({results:[{alternatives:[{transcript:"draft"}],isFinal:false,languageCode:this.language,resultEndOffset:{seconds:0,nanos:Math.round(this.audioBytes/32*1e6)}}]});}
    this.onRequest?.(decoded);callback();
  }
  _final(callback:(error?:Error|null)=>void){callback();if(!this.autoFinish)return;
    const rate=this.configuration?.streamingConfig?.config?.explicitDecodingConfig?.sampleRateHertz??16000;
    this.respond({results:[{alternatives:[{transcript:this.transcript}],isFinal:true,languageCode:this.language,resultEndOffset:{seconds:0,nanos:Math.round(this.audioBytes/(rate*2)*1e9)}}],metadata:{requestId:"google-asr-request",totalBilledDuration:{seconds:1,nanos:0}}});
    this.emit("status",{code:this.statusCode});this.push(null);
  }
  respond(value:GoogleAsrResponse){this.push(decodeGoogleAsrResponse(Buffer.from(protos.google.cloud.speech.v2.StreamingRecognizeResponse.encode(value).finish())));}
  cancel(){if(this.cancelled)return;this.cancelled=true;this.destroy();}
  transport():ReturnType<GoogleAsrStreamFactory>{return {stream:this,close:()=>{this.clientClosed=true;}};}
}
