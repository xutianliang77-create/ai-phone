import {EventEmitter} from "node:events";
import type WebSocket from "ws";
/** Synthetic stream_wsv2 peer; never opens network connections. */
export class SyntheticTencentSpeechSocket extends EventEmitter {
  readyState=0;bufferedAmount=0;sent:Array<Record<string,any>>=[];autoReady=true;autoAudio=true;autoFinal=true;nextId=0;
  onSend?:(event:Record<string,any>)=>void;
  constructor(readonly wireId:string){super();queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit("open");this.control();if(this.autoReady)this.control({ready:1});});}
  send(raw:string,callback:(error?:Error)=>void){const e=JSON.parse(raw);this.sent.push(e);callback();this.onSend?.(e);
    if(e.action==="ACTION_SYNTHESIS"&&this.autoAudio)queueMicrotask(()=>this.audio());
    if(e.action==="ACTION_COMPLETE"&&this.autoFinal)queueMicrotask(()=>this.control({final:1}));
  }
  control(overrides:Record<string,unknown>={}){this.emit("message",Buffer.from(JSON.stringify({code:0,message:"success",session_id:this.wireId,request_id:"tencent-request",
    message_id:`message-${++this.nextId}`,ready:0,final:0,heartbeat:0,result:{subtitles:null},...overrides})),false);}
  audio(bytes=Buffer.alloc(1920)){this.emit("message",bytes,true);}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  asWebSocket(){return this as unknown as WebSocket;}
}
