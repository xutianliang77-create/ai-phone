import {EventEmitter} from "node:events";
import type WebSocket from "ws";
/** Synthetic Tencent ASR peer; no actual network connection. */
export class SyntheticTencentAsrSocket extends EventEmitter {
  readyState=0;bufferedAmount=0;autoAck=true;autoFinal=true;counter=0;samples=0;transcript="Hello world.";
  sent:Array<Buffer|Record<string,unknown>>=[];sentAt:number[]=[];onSend?:(event:Buffer|Record<string,unknown>)=>void;
  constructor(readonly voiceId:string){super();queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit("open");if(this.autoAck)this.receive({});});}
  send(data:Buffer|string,callback:(error?:Error)=>void){const e=Buffer.isBuffer(data)?Buffer.from(data):JSON.parse(data);this.sent.push(e);this.sentAt.push(performance.now());callback();this.onSend?.(e);
    if(Buffer.isBuffer(e)){this.samples+=e.length/2;queueMicrotask(()=>this.result(1,`draft ${this.samples}`));}
    else if(e.type==="end"&&this.autoFinal)queueMicrotask(()=>{this.result(2,this.transcript);this.receive({message_id:`${this.voiceId}_${++this.counter}`,final:1});});
  }
  result(slice:number,text:string,overrides:Record<string,unknown>={}){this.receive({message_id:`${this.voiceId}_${++this.counter}`,result:{slice_type:slice,index:0,start_time:0,end_time:Math.ceil(this.samples/16),voice_text_str:text,...overrides}});}
  receive(e:Record<string,unknown>){this.emit("message",Buffer.from(JSON.stringify({code:0,message:"success",voice_id:this.voiceId,...e})),false);}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  asWebSocket(){return this as unknown as WebSocket;}
}
