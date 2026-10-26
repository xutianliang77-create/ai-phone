import type {WebSocket} from 'ws';
import {selfHostedAdmission} from '@translation/platform-security';
export function bindOperationalDeadline(ws:WebSocket,stop:()=>void){
 const control=selfHostedAdmission();
 if(!control.controlled||control.deadlineMs===null)return;
 const timer=setTimeout(stop,Math.max(1,control.deadlineMs-Date.now()));
 ws.once('close',()=>clearTimeout(timer));
}

export function requireOperationalAdmission(){if(!selfHostedAdmission().open)throw Error("service_admission_closed");}
