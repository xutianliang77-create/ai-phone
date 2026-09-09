import {EventEmitter} from "node:events";
import type WebSocket from "ws";
/** Synthetic protocol peer for tests only; never opens a network connection. */
export class SyntheticAsrSocket extends EventEmitter {
  readyState=0;bufferedAmount=0;sent:Array<Record<string,any>>=[];autoSetup=true;autoComplete=true;previous:string|null=null;turns=0;transcript="Bonjour";
  onSend?:(event:Record<string,any>)=>void;
  constructor(){super();queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit("open");});}
  send(raw:string,callback:(error?:Error)=>void){const event=JSON.parse(raw);this.sent.push(event);callback();this.onSend?.(event);
    if(event.type==="session.update"&&this.autoSetup)queueMicrotask(()=>this.receive({type:"session.updated",session:event.session}));
    if(event.type==="input_audio_buffer.commit"&&this.autoComplete)queueMicrotask(()=>{
      const item=`item-${++this.turns}`;this.receive({type:"input_audio_buffer.committed",item_id:item,previous_item_id:this.previous});this.previous=item;
      this.receive({type:"conversation.item.input_audio_transcription.delta",item_id:item,content_index:0,delta:"Bon"});
      this.receive({type:"conversation.item.input_audio_transcription.completed",item_id:item,content_index:0,transcript:this.transcript,usage:{type:"duration",seconds:0.2}});
    });
  }
  receive(event:unknown){this.emit("message",Buffer.from(JSON.stringify(event)));}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  asWebSocket(){return this as unknown as WebSocket;}
}
