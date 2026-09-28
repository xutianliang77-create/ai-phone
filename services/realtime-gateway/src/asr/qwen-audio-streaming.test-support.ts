import {EventEmitter} from 'node:events';
import type WebSocket from 'ws';
/** Synthetic peer only; never opens a real supplier connection. */
export class SyntheticQwenAudioSocket extends EventEmitter {
  readyState=0;taskId='';sent:Array<any>=[];bytes=0;autoFinish=true;onAudio?:()=>void;
  constructor(){super();queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
  send(raw:string|Buffer,callback:(e?:Error)=>void){
    const e=typeof raw==='string'?JSON.parse(raw):raw;this.sent.push(e);callback();
    if(Buffer.isBuffer(e)){this.bytes+=e.length;this.onAudio?.();return;}
    if(e.header.action==='run-task'){this.taskId=e.header.task_id;queueMicrotask(()=>this.receive('task-started',{}));}
    if(e.header.action==='finish-task'&&this.autoFinish)queueMicrotask(()=>this.receive('task-finished',{}));
  }
  receive(event:string,payload:unknown){this.emit('message',Buffer.from(JSON.stringify({header:{event,task_id:this.taskId},payload})),false);}
  sentence(id:number,text:string,final=true){this.receive('result-generated',{output:{sentence:{sentence_id:id,text,sentence_end:final,
    begin_time:0,end_time:final?this.bytes/32:null,words:[]}}});}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit('close',1000,Buffer.alloc(0));}
  asWebSocket(){return this as unknown as WebSocket;}
}
