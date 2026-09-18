import {EventEmitter} from "node:events";
import type WebSocket from "ws";

/** Synthetic Qwen server-VAD peer. It never opens a network connection. */
export class SyntheticQwenAsrSocket extends EventEmitter {
  readyState=0;bufferedAmount=0;sent:Array<Record<string,any>>=[];model="manual-asr";language="fr";detectedLanguage?:string;
  autoSetup=true;autoComplete=true;autoFinish=true;previous:string|undefined;turns=0;eventId=0;transcript="Bonjour tout le monde.";
  onSend?:(event:Record<string,any>)=>void;
  private cursorMs=0;private speechStartMs:number|undefined;private completionQueued=false;
  constructor(){super();queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit("open");});}
  send(raw:string,callback:(error?:Error)=>void){const e=JSON.parse(raw);this.sent.push(e);callback();this.onSend?.(e);
    if(e.type==="session.update"){
      this.language=e.session.input_audio_transcription.language??this.detectedLanguage??this.language;
      if(this.autoSetup)queueMicrotask(()=>this.receive({type:"session.updated",session:{id:"qwen-session",model:this.model,modalities:["text"],...e.session}}));
    }
    if(e.type==="input_audio_buffer.append"){
      const bytes=Buffer.from(e.audio,"base64");if(this.speechStartMs===undefined)this.speechStartMs=this.cursorMs;
      this.cursorMs+=bytes.length/2/16000*1000;
      if(this.autoComplete&&!this.completionQueued){this.completionQueued=true;queueMicrotask(()=>{this.completionQueued=false;this.complete();});}
    }
    if(e.type==="session.finish"&&this.autoFinish)queueMicrotask(()=>{if(this.speechStartMs!==undefined)this.complete();this.receive({type:"session.finished"});});
  }
  complete(){if(this.speechStartMs===undefined)return;const item=`item-${++this.turns}`,start=this.speechStartMs,end=this.cursorMs;this.speechStartMs=undefined;
    this.receive({type:"input_audio_buffer.speech_started",audio_start_ms:start,item_id:item});
    this.receive({type:"input_audio_buffer.speech_stopped",audio_end_ms:end,item_id:item});
    this.receive({type:"input_audio_buffer.committed",item_id:item,previous_item_id:this.previous??""});
    this.receive({type:"conversation.item.created",previous_item_id:this.previous??"",item:{id:item,type:"message",role:"user",content:[{type:"input_audio",transcript:null}]}});
    this.partial(item,"","Bonjur");this.partial(item,"Bon","jour tout le monde.");
    this.receive({type:"conversation.item.input_audio_transcription.completed",item_id:item,content_index:0,language:this.language,transcript:this.transcript});this.previous=item;
  }
  partial(item:string,text:string,stash:string){this.receive({type:"conversation.item.input_audio_transcription.text",item_id:item,content_index:0,language:this.language,text,stash});}
  receive(e:Record<string,unknown>){this.emit("message",Buffer.from(JSON.stringify({event_id:`event-${++this.eventId}`,...e})),false);}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  asWebSocket(){return this as unknown as WebSocket;}
}
