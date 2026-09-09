import {EventEmitter} from "node:events";
import type WebSocket from "ws";
/** Synthetic ASR peer. It emits cumulative text/stash, never opens a network. */
export class SyntheticQwenAsrSocket extends EventEmitter {
  readyState=0;bufferedAmount=0;sent:Array<Record<string,any>>=[];model="manual-asr";language="fr";
  autoSetup=true;autoComplete=true;previous:string|null=null;turns=0;eventId=0;transcript="Bonjour tout le monde.";
  onSend?:(event:Record<string,any>)=>void;
  constructor(){super();queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit("open");});}
  send(raw:string,callback:(error?:Error)=>void){const e=JSON.parse(raw);this.sent.push(e);callback();this.onSend?.(e);
    if(e.type==="session.update"){this.language=e.session.input_audio_transcription.language;if(this.autoSetup)queueMicrotask(()=>this.receive({type:"session.updated",session:{id:"qwen-session",model:this.model,modalities:["text"],...e.session}}));}
    if(e.type==="input_audio_buffer.commit"&&this.autoComplete)queueMicrotask(()=>this.complete());
  }
  complete(){const item=`item-${++this.turns}`;this.receive({type:"input_audio_buffer.committed",item_id:item,previous_item_id:this.previous??""});
    this.receive({type:"conversation.item.created",previous_item_id:this.previous??"",item:{id:item,type:"message",role:"user",content:[{type:"input_audio",transcript:null}]}});
    this.partial(item,"","Bonjur");this.partial(item,"Bon","jour tout le monde.");
    this.receive({type:"conversation.item.input_audio_transcription.completed",item_id:item,content_index:0,language:this.language,transcript:this.transcript});this.previous=item;
  }
  partial(item:string,text:string,stash:string){this.receive({type:"conversation.item.input_audio_transcription.text",item_id:item,content_index:0,language:this.language,text,stash});}
  receive(e:Record<string,unknown>){this.emit("message",Buffer.from(JSON.stringify({event_id:`event-${++this.eventId}`,...e})),false);}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  asWebSocket(){return this as unknown as WebSocket;}
}
