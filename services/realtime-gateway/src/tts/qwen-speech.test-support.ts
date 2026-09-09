import {EventEmitter} from "node:events";
import type WebSocket from "ws";
/** Synthetic Qwen wire peer only. Never opens a network connection. */
export class SyntheticQwenSpeechSocket extends EventEmitter {
  readyState=0;bufferedAmount=0;sent:Array<Record<string,any>>=[];model="manual-tts";voice="Cherry";
  autoSetup=true;autoAudio=true;autoFinish=true;nextId=0;
  usage:unknown={characters:12};onSend?:(event:Record<string,any>)=>void;
  constructor(){super();queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit("open");});}
  send(raw:string,callback:(error?:Error)=>void){const e=JSON.parse(raw);this.sent.push(e);callback();this.onSend?.(e);
    if(e.type==="session.update"&&this.autoSetup)queueMicrotask(()=>this.receive({type:"session.updated",session:{id:"session-qwen",model:this.model,...e.session}}));
    if(e.type==="input_text_buffer.commit"&&this.autoAudio)queueMicrotask(()=>this.respond());
    if(e.type==="session.finish"&&this.autoFinish)queueMicrotask(()=>this.receive({type:"session.finished"}));
  }
  respond(){
    this.receive({type:"input_text_buffer.committed",item_id:"input"});
    this.receive({type:"response.created",response:{id:"response-qwen",status:"in_progress",voice:this.voice,output:[]}});
    this.receive({type:"response.output_item.added",response_id:"response-qwen",output_index:0,item:{id:"item-qwen",role:"assistant",status:"in_progress"}});
    this.receive({type:"response.content_part.added",response_id:"response-qwen",item_id:"item-qwen",output_index:0,content_index:0,part:{type:"audio"}});
    this.audio();this.receive({type:"response.audio.done",response_id:"response-qwen",item_id:"item-qwen",output_index:0,content_index:0});
    this.receive({type:"response.done",response:{id:"response-qwen",status:"completed",voice:this.voice,
      output:[{id:"item-qwen",status:"completed",role:"assistant",content:[{type:"audio"}]}],...(this.usage===undefined?{}:{usage:this.usage})}});
  }
  audio(overrides:Record<string,unknown>={}){this.receive({type:"response.audio.delta",response_id:"response-qwen",item_id:"item-qwen",output_index:0,content_index:0,delta:Buffer.alloc(1920).toString("base64"),...overrides});}
  receive(e:Record<string,unknown>){this.emit("message",Buffer.from(JSON.stringify({event_id:`event-${++this.nextId}`,...e})),false);}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  asWebSocket(){return this as unknown as WebSocket;}
}
