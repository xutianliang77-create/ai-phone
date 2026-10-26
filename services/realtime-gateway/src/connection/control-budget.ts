import type {WebSocket} from 'ws';
import type {RealtimeSession} from '../sessions/realtime-session.js';

/** The control grant is a ceiling on admitted active audio, not a claim that
 * asynchronous inference/flush tail costs disappeared. */
export function controlClock(session:RealtimeSession,now=Date.now()){
 if(!session.claims.control)return now;
 const remaining=Math.max(0,session.claims.maxDurationSeconds*1000-session.accumulatedActiveMs);
 const activeEnd=session.activeStartedAt===undefined?Infinity:session.activeStartedAt+remaining;
 return Math.min(now,session.claims.control.expiresAtMs,activeEnd);
}
export function controlBudgetExhausted(session:RealtimeSession,now=Date.now()){
 if(!session.claims.control)return false;
 const active=session.accumulatedActiveMs+(session.activeStartedAt===undefined?0:Math.max(0,now-session.activeStartedAt));
 return now>=session.claims.control.expiresAtMs||active>=session.claims.maxDurationSeconds*1000;
}
export function bindControlBudget(ws:WebSocket,session:RealtimeSession,stop:()=>void){
 if(!session.claims.control)return;
 let stopping=false;
 const timer=setInterval(()=>{if(!stopping&&controlBudgetExhausted(session)){stopping=true;stop();}},100);
 ws.once('close',()=>clearInterval(timer));
}
