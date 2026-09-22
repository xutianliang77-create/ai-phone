import type WebSocket from "ws";
import type {PublicModelAttemptEvent,TranslationLanguageCode} from "@translation/contracts";
import type {TranscriptResult} from "./asr-provider.js";
import type {parseOpenAiAsr,PublicAsrError} from "./public-asr-completed-audio.js";
import type {TencentAsrWire} from "./tencent-streaming-asr.js";
import type {GoogleAsrWire} from "./google-streaming-asr.js";
import type {AudioSendObservations} from "./streaming-asr-wire-send.js";

export type Result=ReturnType<typeof parseOpenAiAsr>;
export function deferred<T>() {
  let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});
  void promise.catch(()=>{});return {promise,resolve,reject};
}
export type Turn={event:PublicModelAttemptEvent;prepared:boolean;sent:boolean;terminal:boolean;committing:boolean;ack:boolean;itemId?:string;previousItem?:string;
  providerItemId?:string;providerCreated?:boolean;providerStartSample?:number;providerEndSample?:number;partial:string;confirmedPrefix?:string;
  detectedLanguage?:TranslationLanguageCode;result?:Result;done:ReturnType<typeof deferred<Result>>;finalizing?:Promise<void>};
/** One durable attempt per Qwen server-VAD socket, not per semantic item. */
type QwenTransport={event:PublicModelAttemptEvent;prepared:boolean;sent:boolean;terminal:boolean;finalizing?:Promise<void>};
export type State={ws?:WebSocket;stop:AbortController;ready:ReturnType<typeof deferred<void>>;configured:boolean;failure?:PublicAsrError;cursor:number;sequence:number;
  turn?:Turn;qwenTransport?:QwenTransport;lastItem?:string;seen:Set<string>;busy:boolean;removeAbort:()=>void;wireSessionId?:string;wireEvents?:Set<string>;
  pendingWireEvents:Record<string,any>[];completed:TranscriptResult[];finalization:Promise<void>;finishing:boolean;providerFinished:boolean;
  finished:ReturnType<typeof deferred<void>>;tencentWire?:TencentAsrWire|GoogleAsrWire;lastWireType?:unknown;lastWireLanguage?:unknown;audioSend?:AudioSendObservations};
